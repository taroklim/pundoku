#!/bin/bash
# Dev PD-276/277: полные gates на pd-hotfix. Лог — gates.log, вывод шагов — <pkg>-<step>.out
cd "$(dirname "$0")/../.." || exit 1
OUT=design/pd276-gates
: > $OUT/gates.log
for pkg in engine api web; do
  for step in build typecheck lint test; do
    [ "$pkg" = api ] && [ "$step" = build ] && continue
    [ "$pkg" = web ] && [ "$step" = build ] && continue
    s=$(date +%s)
    pnpm --filter @pundoku/$pkg $step > $OUT/$pkg-$step.out 2>&1; rc=$?
    echo "pnpm --filter @pundoku/$pkg $step -> rc $rc ($(( $(date +%s)-s ))s) load {$(sysctl -n vm.loadavg)}" >> $OUT/gates.log
    [ "$step" = test ] && grep -E "Test Files|Tests " $OUT/$pkg-$step.out | sed 's/\x1b\[[0-9;]*m//g' >> $OUT/gates.log
  done
done
s=$(date +%s); pnpm --filter @pundoku/web build > $OUT/web-build.out 2>&1; rc=$?
echo "pnpm --filter @pundoku/web build -> rc $rc ($(( $(date +%s)-s ))s) load {$(sysctl -n vm.loadavg)}" >> $OUT/gates.log
s=$(date +%s); pnpm --filter @pundoku/api build > $OUT/api-build.out 2>&1; rc=$?
echo "pnpm --filter @pundoku/api build -> rc $rc ($(( $(date +%s)-s ))s)" >> $OUT/gates.log
echo DONE >> $OUT/gates.log
