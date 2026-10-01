#!/bin/sh
# PD-66: ПРОВЕРЕННОЕ восстановление. Разворачивает дамп (plain SQL, .sql или .sql.gz) во ВРЕМЕННУЮ базу, сверяет схему и
# число строк, удаляет временную базу. Ничего, кроме этой временной базы, не создаёт и не трогает.
#
#   sh scripts/verify-dump.sh <дамп.sql|дамп.sql.gz> [таблица=мин:макс ...]
#
# Подключение - обычные переменные libpq (PGHOST, PGPORT, PGUSER, PGPASSWORD); пользователь должен уметь CREATE/DROP
# DATABASE. Служебная база для подключения - $VERIFY_ADMIN_DB (по умолчанию postgres), имя временной - $VERIFY_DB
# (по умолчанию pd_verify_<pid>). Ожидания "таблица=мин:макс": число строк в восстановленной таблице должно попасть в
# отрезок (backup.yml передаёт min/max числа строк прода до и после pg_dump: запись между ними не даёт ложной тревоги).
# Без ожиданий проверяется только то, что таблицы на месте, а schema_migrations непуста.
# Выход 0 - восстановление подтверждено; не 0 - сообщение "verify-dump: FAIL ..." в stderr.
set -eu

fail() { echo "verify-dump: FAIL - $*" >&2; exit 1; }

[ $# -ge 1 ] || fail "usage: verify-dump.sh <dump.sql[.gz]> [table=min:max ...]"
dump=$1; shift
[ -s "$dump" ] || fail "dump file is missing or empty: $dump"

admin_db=${VERIFY_ADMIN_DB:-postgres}
db=${VERIFY_DB:-pd_verify_$$}
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
created=0
restore_pid=
cleanup() {
  [ -z "$restore_pid" ] || kill "$restore_pid" 2>/dev/null || true
  if [ "$created" = 1 ]; then
    psql -d "$admin_db" -X -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" >/dev/null 2>&1 \
      || echo "verify-dump: WARN - could not drop temporary database $db" >&2
  fi
  [ -z "${plain:-}" ] || rm -f "$plain"
}
# Чистим и на сигнале: без этого SIGTERM (отмена job'а в Actions, timeout) оставлял бы pd_verify_* и /tmp/pd-verify.*.
# `exit` в обработчике сигнала запускает EXIT-ловушку; код 128+N, как у шелла.
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP

# Читаем ровно тот файл, который уедет в артефакт; gz распаковываем во временный файл (нужен хвост и повторное чтение).
plain=$(mktemp "${TMPDIR:-/tmp}/pd-verify.XXXXXX")
case $dump in
  *.gz) gzip -dc "$dump" >"$plain" || fail "cannot gunzip $dump" ;;
  *) cat "$dump" >"$plain" ;;
esac
[ -s "$plain" ] || fail "dump is empty after decompression"
# pg_dump заканчивает plain-дамп этим маркером; его отсутствие - файл оборван.
tail -n 30 "$plain" | grep -q "PostgreSQL database dump complete" || fail "dump has no completion trailer - file is truncated"

psql -d "$admin_db" -X -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$db\"" >/dev/null || fail "cannot create temporary database $db"
created=1

# Долгое восстановление - в фоне + wait: шелл откладывает ловушку сигнала, пока жив foreground-потомок, а wait прерывается сразу.
psql -d "$db" -X -q -v ON_ERROR_STOP=1 -f "$plain" >/dev/null &
restore_pid=$!
wait "$restore_pid" || fail "psql could not restore the dump into a clean database"

tables=$(psql -d "$db" -X -At -c "select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('devices','snapshots','daily_puzzles','sync_groups','device_links','schema_migrations')")
echo "verify-dump: key tables restored: $tables of 6"
[ "$tables" = 6 ] || fail "restored database is missing key tables ($tables of 6)"

counts=$(psql -d "$db" -X -At -v ON_ERROR_STOP=1 -f "$here/table-counts.sql") || fail "cannot count rows in the restored database"
echo "$counts" | sed 's/^/verify-dump: restored /'
migrations=$(echo "$counts" | sed -n 's/^schema_migrations=//p')
[ "${migrations:-0}" -ge 1 ] || fail "restored schema_migrations is empty"

for exp in "$@"; do
  table=${exp%%=*}
  range=${exp#*=}
  lo=${range%%:*}
  hi=${range#*:}
  actual=$(echo "$counts" | sed -n "s/^$table=//p")
  [ -n "$actual" ] || fail "no count for expected table '$table'"
  if [ "$actual" -lt "$lo" ] || [ "$actual" -gt "$hi" ]; then
    fail "$table: restored $actual rows, production had $lo..$hi (data lost or dump truncated)"
  fi
  echo "verify-dump: $table=$actual within $lo..$hi"
done
echo "verify-dump: OK"
