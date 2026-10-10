export default () => <svg viewBox='0 0 760 470' role='img' aria-label='Место 7, Today не загрузился: спящий Питомец рядом с текстом ошибки и Try again под приглушённым пустым полем. Решение — да'>
  <rect x='24' y='16' width='200' height='434' rx='28' fill='none' stroke='var(--cds-chart-axis)' strokeWidth='1.5' />
  <rect x='94' y='24' width='60' height='14' rx='7' fill='var(--cds-chart-axis)' fillOpacity='0.6' />
  <text x='38' y='70' fontSize='20' fontWeight='700' fill='var(--cds-text-primary)'>Today</text>
  <circle cx='182' cy='62' r='8' fill='none' stroke='var(--cds-chart-categorical-1)' strokeWidth='1.5' />
  <circle cx='206' cy='62' r='8' fill='none' stroke='var(--cds-chart-categorical-1)' strokeWidth='1.5' />
  <text x='38' y='90' fontSize='12' fill='var(--cds-text-secondary)'>Thursday, October 8</text>
  {[0, 1, 2].map((r) => [0, 1, 2].map((c) => <rect key={r * 3 + c} x={36 + c * 59} y={100 + r * 59} width='56' height='56' rx='6' fill='var(--cds-chart-grid)' fillOpacity='0.2' />))}
  <g transform='translate(58 306) scale(0.8) translate(-24 -39)'>
    <path d='M24 25.4 C34 25.4 42 28.5 42.5 32.5 C43.5 37 37 39 24 39 C11 39 4.5 37 5.5 32.5 C6 28.5 14 25.4 24 25.4 Z' fill='var(--cds-chart-categorical-1)' />
    <path d='M15.36 32.85 h5.4 M27.24 32.85 h5.4' fill='none' stroke='var(--cds-text-primary)' strokeWidth='2.4' strokeLinecap='round' />
    <circle cx='45.4' cy='36.6' r='1.4' fill='var(--cds-chart-categorical-1)' />
  </g>
  <circle cx='59' cy='298' r='19' fill='none' stroke='var(--cds-chart-categorical-2)' strokeWidth='1.5' strokeDasharray='4 3' />
  <text x='84' y='294' fontSize='12' fill='var(--cds-text-secondary)'>Couldn’t load today’s</text>
  <text x='84' y='310' fontSize='12' fill='var(--cds-text-secondary)'>puzzle.</text>
  <text x='128' y='310' fontSize='12' fontWeight='600' fill='var(--cds-chart-categorical-1)'>Try again</text>
  {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => <rect key={i} x={36 + i * 20} y='330' width='17' height='28' rx='4' fill='var(--cds-chart-grid)' fillOpacity='0.25' />)}
  <path d='M25 408 H223 V422 Q223 449 196 449 H52 Q25 449 25 422 Z' fill='var(--cds-chart-grid)' fillOpacity='0.6' />
  <text x='57' y='430' fontSize='12' textAnchor='middle' fill='var(--cds-chart-categorical-1)'>Today</text>
  <text x='124' y='430' fontSize='12' textAnchor='middle' fill='var(--cds-text-secondary)'>Play</text>
  <text x='191' y='430' fontSize='12' textAnchor='middle' fill='var(--cds-text-secondary)'>Year</text>

  <text x='252' y='36' fontSize='18' fontWeight='600' fill='var(--cds-text-primary)'>7 · Офлайн / не загрузилось</text>
  <rect x='252' y='48' width='132' height='26' rx='7' fill='var(--cds-chart-categorical-1)' fillOpacity='0.25' />
  <text x='318' y='66' fontSize='13' fontWeight='700' textAnchor='middle' fill='var(--cds-text-primary)'>ДА · трудоёмкость S</text>
  <text x='252' y='104' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Что делает</text>
  <text x='252' y='122' fontSize='13' fill='var(--cds-text-secondary)'>Спит (40 pt) слева от «Couldn’t load today’s puzzle.</text>
  <text x='252' y='140' fontSize='13' fill='var(--cds-text-secondary)'>Try again» — и в архиве у «This day’s puzzle isn’t available».</text>
  <text x='252' y='170' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Плюсы</text>
  <text x='252' y='188' fontSize='13' fill='var(--cds-text-secondary)'>+ смягчает ошибку; поле пустое и приглушено — отвлекать</text>
  <text x='252' y='206' fontSize='13' fill='var(--cds-text-secondary)'>   не от чего, правило «где поле — нет Питомца» не задето</text>
  <text x='252' y='224' fontSize='13' fill='var(--cds-text-secondary)'>+ «спит» = день не сыгран — смысл честный</text>
  <text x='252' y='242' fontSize='13' fill='var(--cds-text-secondary)'>+ новых строк i18n нет</text>
  <text x='252' y='272' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Минусы</text>
  <text x='252' y='290' fontSize='13' fill='var(--cds-text-secondary)'>− 320×568: зазор между полем и панелью тесный, текст</text>
  <text x='252' y='308' fontSize='13' fill='var(--cds-text-secondary)'>   в 2 строки; при AX3 клякса уходит над текстом</text>
  <text x='252' y='326' fontSize='13' fill='var(--cds-text-secondary)'>− зона 44 не должна задевать «Try again» (проверка в кадрах)</text>
  <text x='252' y='356' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Десктоп C</text>
  <text x='252' y='374' fontSize='13' fill='var(--cds-text-secondary)'>в инспекторе рядом со статусом ошибки</text>
</svg>;
