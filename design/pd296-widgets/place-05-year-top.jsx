export default () => <svg viewBox='0 0 760 470' role='img' aria-label='Место 5, верх Year: Питомец сегодняшнего дня у заголовка года. Решение — да'>
  <rect x='24' y='16' width='200' height='434' rx='28' fill='none' stroke='var(--cds-chart-axis)' strokeWidth='1.5' />
  <rect x='94' y='24' width='60' height='14' rx='7' fill='var(--cds-chart-axis)' fillOpacity='0.6' />
  <text x='38' y='70' fontSize='20' fontWeight='700' fill='var(--cds-text-primary)'>2026 ⌄</text>
  <g transform='translate(124 72) scale(0.8) translate(-24 -39)'>
    <path d='M24 15.3 C32.5 15.3 39 20.5 39.5 27.5 C40.5 34.5 35 39 24 39 C13 39 7.5 34.5 8.5 27.5 C9 20.5 15.5 15.3 24 15.3 Z' fill='var(--cds-chart-categorical-1)' />
    <path d='M16.45 27.98 q2.6 -3.6 5.2 0 M26.35 27.98 q2.6 -3.6 5.2 0' fill='none' stroke='var(--cds-text-primary)' strokeWidth='2.4' strokeLinecap='round' />
    <circle cx='43' cy='35.5' r='1.7' fill='var(--cds-chart-categorical-1)' />
  </g>
  <circle cx='125' cy='60' r='19' fill='none' stroke='var(--cds-chart-categorical-2)' strokeWidth='1.5' strokeDasharray='4 3' />
  <circle cx='206' cy='62' r='8' fill='none' stroke='var(--cds-chart-categorical-1)' strokeWidth='1.5' />
  <text x='38' y='96' fontSize='12' fill='var(--cds-text-secondary)'>212 days · 160 clean</text>
  <text x='38' y='124' fontSize='12' fill='var(--cds-text-secondary)'>October</text>
  {[0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4, 5, 6].map((c) => <rect key={r * 7 + c} x={38 + c * 25} y={132 + r * 25} width='21' height='21' rx='4' fill='var(--cds-chart-categorical-1)' fillOpacity={0.3 + ((r * 7 + c) * 37 % 10) / 15} />))}
  <text x='38' y='274' fontSize='12' fill='var(--cds-text-secondary)'>September</text>
  {[0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4, 5, 6].map((c) => <rect key={r * 7 + c} x={38 + c * 25} y={282 + r * 25} width='21' height='21' rx='4' fill='var(--cds-chart-categorical-1)' fillOpacity={0.3 + ((r * 7 + c) * 53 % 10) / 15} />))}
  <path d='M25 408 H223 V422 Q223 449 196 449 H52 Q25 449 25 422 Z' fill='var(--cds-chart-grid)' />
  <text x='57' y='430' fontSize='12' textAnchor='middle' fill='var(--cds-text-secondary)'>Today</text>
  <text x='124' y='430' fontSize='12' textAnchor='middle' fill='var(--cds-text-secondary)'>Play</text>
  <text x='191' y='430' fontSize='12' textAnchor='middle' fill='var(--cds-chart-categorical-1)'>Year</text>

  <text x='252' y='36' fontSize='18' fontWeight='600' fill='var(--cds-text-primary)'>5 · Верх Year: Питомец сегодняшнего дня</text>
  <rect x='252' y='48' width='132' height='26' rx='7' fill='var(--cds-chart-categorical-1)' fillOpacity='0.25' />
  <text x='318' y='66' fontSize='13' fontWeight='700' textAnchor='middle' fill='var(--cds-text-primary)'>ДА · трудоёмкость M</text>
  <text x='252' y='104' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Что делает</text>
  <text x='252' y='122' fontSize='13' fill='var(--cds-text-secondary)'>У заголовка года: спит, пока сегодняшний день не решён,</text>
  <text x='252' y='140' fontSize='13' fill='var(--cds-text-secondary)'>потом — настроение дня. Тап — реакция (лист не открывает).</text>
  <text x='252' y='170' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Плюсы</text>
  <text x='252' y='188' fontSize='13' fill='var(--cds-text-secondary)'>+ Year — «дом» Питомца (листы дней), всегда под рукой</text>
  <text x='252' y='206' fontSize='13' fill='var(--cds-text-secondary)'>+ итог сегодняшнего дня виден, не открывая лист</text>
  <text x='252' y='236' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Минусы</text>
  <text x='252' y='254' fontSize='13' fill='var(--cds-text-secondary)'>− нужно «настроение сегодня» вне карточки (есть в Year)</text>
  <text x='252' y='272' fontSize='13' fill='var(--cds-text-secondary)'>− пока открыт лист дня, этот замирает: дышит один</text>
  <text x='252' y='290' fontSize='13' fill='var(--cds-text-secondary)'>− 320 pt + AX3: «2026 ⌄», клякса и шестерёнка впритык —</text>
  <text x='252' y='308' fontSize='13' fill='var(--cds-text-secondary)'>   при нехватке места клякса уходит (заголовок важнее)</text>
  <text x='252' y='338' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Десктоп C</text>
  <text x='252' y='356' fontSize='13' fill='var(--cds-text-secondary)'>в тулбаре Year у заголовка; места с запасом</text>
</svg>;
