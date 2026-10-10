export default () => <svg viewBox='0 0 760 470' role='img' aria-label='Место 4, пустой Year: крупный спящий Питомец над строкой Your year starts today. Решение — да'>
  <rect x='24' y='16' width='200' height='434' rx='28' fill='none' stroke='var(--cds-chart-axis)' strokeWidth='1.5' />
  <rect x='94' y='24' width='60' height='14' rx='7' fill='var(--cds-chart-axis)' fillOpacity='0.6' />
  <text x='38' y='70' fontSize='20' fontWeight='700' fill='var(--cds-text-primary)'>2026</text>
  <circle cx='206' cy='62' r='8' fill='none' stroke='var(--cds-chart-categorical-1)' strokeWidth='1.5' />
  <g transform='translate(124 150) scale(1.45) translate(-24 -39)'>
    <path d='M24 25.4 C34 25.4 42 28.5 42.5 32.5 C43.5 37 37 39 24 39 C11 39 4.5 37 5.5 32.5 C6 28.5 14 25.4 24 25.4 Z' fill='var(--cds-chart-categorical-1)' />
    <path d='M15.36 32.85 h5.4 M27.24 32.85 h5.4' fill='none' stroke='var(--cds-text-primary)' strokeWidth='2.4' strokeLinecap='round' />
    <circle cx='45.4' cy='36.6' r='1.4' fill='var(--cds-chart-categorical-1)' />
  </g>
  <circle cx='124' cy='138' r='34' fill='none' stroke='var(--cds-chart-categorical-2)' strokeWidth='1.5' strokeDasharray='4 3' />
  <text x='124' y='192' fontSize='12' textAnchor='middle' fill='var(--cds-text-secondary)'>Your year starts today.</text>
  <text x='124' y='208' fontSize='12' textAnchor='middle' fill='var(--cds-text-secondary)'>Each day you play</text>
  <text x='124' y='224' fontSize='12' textAnchor='middle' fill='var(--cds-text-secondary)'>leaves one mark here.</text>
  <rect x='44' y='236' width='160' height='30' rx='8' fill='var(--cds-chart-categorical-1)' fillOpacity='0.25' stroke='var(--cds-chart-categorical-1)' strokeWidth='1' />
  <text x='124' y='256' fontSize='12' fontWeight='600' textAnchor='middle' fill='var(--cds-text-primary)'>Open today’s puzzle</text>
  <text x='38' y='292' fontSize='12' fill='var(--cds-text-secondary)'>October</text>
  {[0, 1, 2, 3].map((r) => [0, 1, 2, 3, 4, 5, 6].map((c) => <rect key={r * 7 + c} x={38 + c * 25} y={300 + r * 25} width='21' height='21' rx='4' fill='none' stroke='var(--cds-chart-grid)' strokeWidth='1' />))}
  <path d='M25 408 H223 V422 Q223 449 196 449 H52 Q25 449 25 422 Z' fill='var(--cds-chart-grid)' fillOpacity='0.6' />
  <text x='57' y='430' fontSize='12' textAnchor='middle' fill='var(--cds-text-secondary)'>Today</text>
  <text x='124' y='430' fontSize='12' textAnchor='middle' fill='var(--cds-text-secondary)'>Play</text>
  <text x='191' y='430' fontSize='12' textAnchor='middle' fill='var(--cds-chart-categorical-1)'>Year</text>

  <text x='252' y='36' fontSize='18' fontWeight='600' fill='var(--cds-text-primary)'>4 · Пустой Year</text>
  <rect x='252' y='48' width='132' height='26' rx='7' fill='var(--cds-chart-categorical-1)' fillOpacity='0.25' />
  <text x='318' y='66' fontSize='13' fontWeight='700' textAnchor='middle' fill='var(--cds-text-primary)'>ДА · трудоёмкость S</text>
  <text x='252' y='104' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Что делает</text>
  <text x='252' y='122' fontSize='13' fill='var(--cds-text-secondary)'>Спит (64 pt) над строкой «Your year starts today»,</text>
  <text x='252' y='140' fontSize='13' fill='var(--cds-text-secondary)'>дышит, отвечает на тап. После первого дня экран уходит.</text>
  <text x='252' y='170' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Плюсы</text>
  <text x='252' y='188' fontSize='13' fill='var(--cds-text-secondary)'>+ пустое состояние — классическое место персонажа</text>
  <text x='252' y='206' fontSize='13' fill='var(--cds-text-secondary)'>+ поля нет, отвлекать не от чего</text>
  <text x='252' y='224' fontSize='13' fill='var(--cds-text-secondary)'>+ смысл честный: «спит» = ещё не играли</text>
  <text x='252' y='242' fontSize='13' fill='var(--cds-text-secondary)'>+ первое знакомство с Питомцем; новых строк i18n нет</text>
  <text x='252' y='272' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Минусы</text>
  <text x='252' y='290' fontSize='13' fill='var(--cds-text-secondary)'>− виден почти один раз (зато почти бесплатно)</text>
  <text x='252' y='308' fontSize='13' fill='var(--cds-text-secondary)'>− 320×568: кнопка остаётся над таб-баром (PD-277) — проверить</text>
  <text x='252' y='338' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Десктоп C, тёмная</text>
  <text x='252' y='356' fontSize='13' fill='var(--cds-text-secondary)'>по центру области Year; чернила тёмной темы, глаза —</text>
  <text x='252' y='374' fontSize='13' fill='var(--cds-text-secondary)'>прорези в фон, как сейчас</text>
</svg>;
