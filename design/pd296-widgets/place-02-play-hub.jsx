export default () => <svg viewBox='0 0 760 470' role='img' aria-label='Место 2, хаб Play: Питомец с настроением дня у заголовка списка игр. Решение — нет'>
  <rect x='24' y='16' width='200' height='434' rx='28' fill='none' stroke='var(--cds-chart-axis)' strokeWidth='1.5' />
  <rect x='94' y='24' width='60' height='14' rx='7' fill='var(--cds-chart-axis)' fillOpacity='0.6' />
  <text x='38' y='70' fontSize='20' fontWeight='700' fill='var(--cds-text-primary)'>Play</text>
  <g transform='translate(110 70) scale(0.8) translate(-24 -39)'>
    <path d='M24 25.4 C34 25.4 42 28.5 42.5 32.5 C43.5 37 37 39 24 39 C11 39 4.5 37 5.5 32.5 C6 28.5 14 25.4 24 25.4 Z' fill='var(--cds-chart-categorical-1)' />
    <path d='M15.36 32.85 h5.4 M27.24 32.85 h5.4' fill='none' stroke='var(--cds-text-primary)' strokeWidth='2.4' strokeLinecap='round' />
    <circle cx='45.4' cy='36.6' r='1.4' fill='var(--cds-chart-categorical-1)' />
  </g>
  <circle cx='111' cy='62' r='17' fill='none' stroke='var(--cds-chart-categorical-2)' strokeWidth='1.5' strokeDasharray='4 3' />
  <circle cx='206' cy='62' r='8' fill='none' stroke='var(--cds-chart-categorical-1)' strokeWidth='1.5' />
  <text x='38' y='100' fontSize='12' fill='var(--cds-text-secondary)'>Continue</text>
  <rect x='36' y='106' width='176' height='34' rx='8' fill='var(--cds-chart-grid)' fillOpacity='0.5' />
  <text x='46' y='127' fontSize='12' fill='var(--cds-text-primary)'>Today’s puzzle</text>
  <text x='38' y='162' fontSize='12' fill='var(--cds-text-secondary)'>New game</text>
  <rect x='36' y='168' width='176' height='192' rx='8' fill='var(--cds-chart-grid)' fillOpacity='0.5' />
  <text x='46' y='190' fontSize='12' fill='var(--cds-text-primary)'>Classic</text>
  <text x='46' y='222' fontSize='12' fill='var(--cds-text-primary)'>Ink</text>
  <text x='46' y='254' fontSize='12' fill='var(--cds-text-primary)'>Liar</text>
  <text x='46' y='286' fontSize='12' fill='var(--cds-text-primary)'>Melody</text>
  <text x='46' y='318' fontSize='12' fill='var(--cds-text-primary)'>Lantern</text>
  <text x='46' y='350' fontSize='12' fill='var(--cds-text-primary)'>Glyphs</text>
  {[0, 1, 2, 3, 4].map((i) => <line key={i} x1='46' y1={200 + i * 32} x2='212' y2={200 + i * 32} stroke='var(--cds-chart-axis)' strokeWidth='0.5' />)}
  <path d='M25 408 H223 V422 Q223 449 196 449 H52 Q25 449 25 422 Z' fill='var(--cds-chart-grid)' fillOpacity='0.6' />
  <text x='57' y='430' fontSize='12' textAnchor='middle' fill='var(--cds-text-secondary)'>Today</text>
  <text x='124' y='430' fontSize='12' textAnchor='middle' fill='var(--cds-chart-categorical-1)'>Play</text>
  <text x='191' y='430' fontSize='12' textAnchor='middle' fill='var(--cds-text-secondary)'>Year</text>

  <text x='252' y='36' fontSize='18' fontWeight='600' fill='var(--cds-text-primary)'>2 · Хаб Play (шапка)</text>
  <rect x='252' y='48' width='132' height='26' rx='7' fill='var(--cds-chart-grid)' fillOpacity='0.6' />
  <text x='318' y='66' fontSize='13' fontWeight='700' textAnchor='middle' fill='var(--cds-text-primary)'>НЕТ · трудоёмкость S</text>
  <text x='252' y='104' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Что делает</text>
  <text x='252' y='122' fontSize='13' fill='var(--cds-text-secondary)'>Сидит у заголовка Play с настроением сегодняшнего</text>
  <text x='252' y='140' fontSize='13' fill='var(--cds-text-secondary)'>дня (спит, пока день не решён); тап — реакция.</text>
  <text x='252' y='170' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Плюсы</text>
  <text x='252' y='188' fontSize='13' fill='var(--cds-text-secondary)'>+ поля нет, места в шапке хватает и на 320 pt</text>
  <text x='252' y='218' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Минусы</text>
  <text x='252' y='236' fontSize='13' fill='var(--cds-text-secondary)'>− хаб — выбор игры; настроение дня здесь ничего</text>
  <text x='252' y='254' fontSize='13' fill='var(--cds-text-secondary)'>   не сообщает: чистое украшение у меню</text>
  <text x='252' y='272' fontSize='13' fill='var(--cds-text-secondary)'>− дублирует «Верх Year» (место 5) — один дом лучше двух</text>
  <text x='252' y='290' fontSize='13' fill='var(--cds-text-secondary)'>− в Play бывают партии не дня (свободная игра):</text>
  <text x='252' y='308' fontSize='13' fill='var(--cds-text-secondary)'>   чьё это настроение — непонятно</text>
  <text x='252' y='338' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Десктоп C</text>
  <text x='252' y='356' fontSize='13' fill='var(--cds-text-secondary)'>хаб в той же колонке, вывод тот же</text>
</svg>;
