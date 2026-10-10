export default () => <svg viewBox='0 0 760 470' role='img' aria-label='Место 8, картинка Поделиться: клякса-печать в углу PNG-отпечатка и переключатель Show Blot в листе экспорта. Решение — позже'>
  <rect x='24' y='16' width='200' height='434' rx='28' fill='none' stroke='var(--cds-chart-axis)' strokeWidth='1.5' />
  <rect x='25' y='17' width='198' height='432' rx='27' fill='var(--cds-text-primary)' fillOpacity='0.12' />
  <rect x='94' y='24' width='60' height='14' rx='7' fill='var(--cds-chart-axis)' fillOpacity='0.6' />
  <rect x='25' y='62' width='198' height='387' rx='14' fill='var(--cds-chart-grid)' fillOpacity='0.55' stroke='var(--cds-chart-axis)' strokeWidth='0.5' />
  <text x='38' y='88' fontSize='12' fill='var(--cds-chart-categorical-1)'>Cancel</text>
  <text x='124' y='88' fontSize='13' fontWeight='600' textAnchor='middle' fill='var(--cds-text-primary)'>Share</text>
  <rect x='64' y='100' width='120' height='150' rx='4' fill='none' stroke='var(--cds-chart-axis)' strokeWidth='1' />
  {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((r) => [0, 1, 2, 3, 4, 5, 6, 7, 8].map((c) => <rect key={r * 9 + c} x={71 + c * 11.8} y={122 + r * 11.8} width='10.6' height='10.6' rx='1.5' fill='var(--cds-chart-categorical-1)' fillOpacity={(r * 9 + c) % 4 === 0 ? 0 : 0.2 + ((r * 9 + c) / 81) * 0.8} stroke='var(--cds-chart-grid)' strokeWidth='0.5' />))}
  <text x='71' y='243' fontSize='12' fontWeight='600' fill='var(--cds-text-primary)'>Pundoku</text>
  <g transform='translate(170 119) scale(0.4) translate(-24 -39)'>
    <path d='M24 15.3 C32.5 15.3 39 20.5 39.5 27.5 C40.5 34.5 35 39 24 39 C13 39 7.5 34.5 8.5 27.5 C9 20.5 15.5 15.3 24 15.3 Z' fill='var(--cds-chart-categorical-1)' />
    <path d='M16.45 27.98 q2.6 -3.6 5.2 0 M26.35 27.98 q2.6 -3.6 5.2 0' fill='none' stroke='var(--cds-text-primary)' strokeWidth='2.4' strokeLinecap='round' />
    <circle cx='43' cy='35.5' r='1.7' fill='var(--cds-chart-categorical-1)' />
  </g>
  <circle cx='170' cy='112' r='12' fill='none' stroke='var(--cds-chart-categorical-2)' strokeWidth='1.5' strokeDasharray='3 3' />
  <rect x='36' y='262' width='176' height='34' rx='8' fill='var(--cds-chart-grid)' fillOpacity='0.6' />
  <text x='46' y='283' fontSize='12' fill='var(--cds-text-primary)'>Show Blot</text>
  <rect x='174' y='270' width='30' height='18' rx='9' fill='var(--cds-chart-categorical-1)' />
  <circle cx='195' cy='279' r='7' fill='var(--cds-chart-reference-tint)' />
  <text x='38' y='316' fontSize='12' fill='var(--cds-text-secondary)'>The blot shows how</text>
  <text x='38' y='332' fontSize='12' fill='var(--cds-text-secondary)'>the day went.</text>
  <rect x='36' y='346' width='176' height='32' rx='8' fill='var(--cds-chart-categorical-1)' fillOpacity='0.25' stroke='var(--cds-chart-categorical-1)' strokeWidth='1' />
  <text x='124' y='367' fontSize='12' fontWeight='600' textAnchor='middle' fill='var(--cds-text-primary)'>Share</text>

  <text x='252' y='36' fontSize='18' fontWeight='600' fill='var(--cds-text-primary)'>8 · Картинка «Поделиться» (PNG)</text>
  <rect x='252' y='48' width='150' height='26' rx='7' fill='var(--cds-chart-categorical-3)' fillOpacity='0.25' />
  <text x='327' y='66' fontSize='13' fontWeight='700' textAnchor='middle' fill='var(--cds-text-primary)'>ПОЗЖЕ · трудоёмкость M</text>
  <text x='252' y='104' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Что делает</text>
  <text x='252' y='122' fontSize='13' fill='var(--cds-text-secondary)'>Неподвижная клякса-печать (112 px из 1080) в пустой</text>
  <text x='252' y='140' fontSize='13' fill='var(--cds-text-secondary)'>верхней полосе PNG, настроение дня; переключатель</text>
  <text x='252' y='158' fontSize='13' fill='var(--cds-text-secondary)'>«Show Blot» в листе экспорта.</text>
  <text x='252' y='188' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Плюсы</text>
  <text x='252' y='206' fontSize='13' fill='var(--cds-text-secondary)'>+ отпечаток становится узнаваемым, «своим»</text>
  <text x='252' y='224' fontSize='13' fill='var(--cds-text-secondary)'>+ место есть: полоса над сеткой пустая</text>
  <text x='252' y='254' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Минусы</text>
  <text x='252' y='272' fontSize='13' fill='var(--cds-text-secondary)'>− меняет утверждённый PNG (PD-75): чернила там = путь</text>
  <text x='252' y='290' fontSize='13' fill='var(--cds-text-secondary)'>− «устал» выдаёт правки/подсказки — нужен явный выбор</text>
  <text x='252' y='308' fontSize='13' fill='var(--cds-text-secondary)'>− новая строка i18n ×3, маска глаз в canvas</text>
  <text x='252' y='326' fontSize='13' fill='var(--cds-text-secondary)'>− без анимации и тапа: это картинка</text>
  <text x='252' y='356' fontSize='13' fontWeight='600' fill='var(--cds-text-primary)'>Тема</text>
  <text x='252' y='374' fontSize='13' fill='var(--cds-text-secondary)'>PNG всегда светлый (как сейчас), чернила светлой темы</text>
</svg>;
