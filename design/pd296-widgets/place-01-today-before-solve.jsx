export default () => <svg viewBox='0 0 760 470' role='img' aria-label='Место 1, Today до решения: спящий Питомец в шапке над полем. Решение — нет'>
  <rect x='24' y='16' width='200' height='434' rx='28' fill='none' stroke='var(--cds-chart-axis)' strokeWidth='1.5' />
  <rect x='94' y='24' width='60' height='14' rx='7' fill='var(--cds-chart-axis)' fillOpacity='0.6' />
  <text x='38' y='70' fontSize='20' fontWeight='700' fill='var(--cds-text-primary)'>Today</text>
  <g transform='translate(146 70) scale(0.8) translate(-24 -39)'>
    <path d='M24 25.4 C34 25.4 42 28.5 42.5 32.5 C43.5 37 37 39 24 39 C11 39 4.5 37 5.5 32.5 C6 28.5 14 25.4 24 25.4 Z' fill='var(--cds-chart-categorical-1)' />
    <path d='M15.36 32.85 h5.4 M27.24 32.85 h5.4' fill='none' stroke='var(--cds-text-primary)' strokeWidth='2.4' strokeLinecap='round' />
    <circle cx='45.4' cy='36.6' r='1.4' fill='var(--cds-chart-categorical-1)' />
  </g>
  <circle cx='147' cy='62' r='17' fill='none' stroke='var(--cds-chart-categorical-2)' strokeWidth='1.5' strokeDasharray='4 3' />
  <circle cx='182' cy='62' r='8' fill='none' stroke='var(--cds-chart-categorical-1)' strokeWidth='1.5' />
  <circle cx='206' cy='62' r='8' fill='none' stroke='var(--cds-chart-categorical-1)' strokeWidth='1.5' />
  <text x='38' y='90' fontSize='12' fill='var(--cds-text-secondary)'>Thursday, October 8 · Medium</text>
  {[0, 1, 2].map((r) => [0, 1, 2].map((c) => <rect key={r * 3 + c} x={36 + c * 59} y={100 + r * 59} width='56' height='56' rx='6' fill='var(--cds-chart-grid)' fillOpacity='0.5' />))}
  <text x='124' y='300' fontSize='12' textAnchor='middle' fill='var(--cds-text-secondary)'>41 cells left</text>
  {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => <rect key={i} x={36 + i * 20} y='312' width='17' height='28' rx='4' fill='var(--cds-chart-grid)' fillOpacity='0.5' />)}
  {[0, 1, 2, 3].map((i) => <rect key={i} x={48 + i * 44} y='352' width='20' height='16' rx='4' fill='var(--cds-chart-categorical-1)' fillOpacity='0.35' />)}
  <path d='M25 408 H223 V422 Q223 449 196 449 H52 Q25 449 25 422 Z' fill='var(--cds-chart-grid)' fillOpacity='0.6' />
  <text x='57' y='430' fontSize='12' textAnchor='middle' fill='var(--cds-chart-categorical-1)'>Today</text>
  <text x='124' y='430' fontSize='12' textAnchor='middle' fill='var(--cds-text-secondary)'>Play</text>
  <text x='191' y='430' fontSize='12' textAnchor='middle' fill='var(--cds-text-secondary)'>Year</text>

  <text x='252' y='36' fontSize='18' fontWeight='600' fill='var(--cds-text-primary)'>1 · Today до решения (шапка)</text>
  <rect x='252' y='48' width='132' height='26' rx='7' fill='var(--cds-chart-grid)' fillOpacity='0.6' />
  <text x='318' y='66' fontSize='13' fontWeight='700' textAnchor='middle' fill='var(--cds-text-primary)'>НЕТ · трудоёмкость S</text>
  <text x='252' y='104' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Что делает</text>
  <text x='252' y='122' fontSize='13' fill='var(--cds-text-secondary)'>Спит у заголовка Today, пока день не решён;</text>
  <text x='252' y='140' fontSize='13' fill='var(--cds-text-secondary)'>после решения «прилетает» на карточку результата.</text>
  <text x='252' y='170' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Плюсы</text>
  <text x='252' y='188' fontSize='13' fill='var(--cds-text-secondary)'>+ связь «день → Питомец» видна с утра</text>
  <text x='252' y='218' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Минусы</text>
  <text x='252' y='236' fontSize='13' fill='var(--cds-text-secondary)'>− поле на экране: дышащая клякса в поле зрения</text>
  <text x='252' y='254' fontSize='13' fill='var(--cds-text-secondary)'>   мешает решать — а Питомец теперь включён у всех</text>
  <text x='252' y='272' fontSize='13' fill='var(--cds-text-secondary)'>− нарушает правило «где поле — там Питомца нет»</text>
  <text x='252' y='290' fontSize='13' fill='var(--cds-text-secondary)'>− шапка занята: лампочка подсказки и шестерёнка;</text>
  <text x='252' y='308' fontSize='13' fill='var(--cds-text-secondary)'>   на 320 pt заголовок и кнопки впритык</text>
  <text x='252' y='338' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Десктоп C</text>
  <text x='252' y='356' fontSize='13' fill='var(--cds-text-secondary)'>то же: поле в центре — клякса в тулбаре отвлекает</text>
  <text x='252' y='386' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Пунктир</text>
  <text x='252' y='404' fontSize='13' fill='var(--cds-text-secondary)'>— предлагаемое место (в приложении его нет)</text>
</svg>;
