import { useRef, useState } from 'react';
import UnicodeField from './UnicodeField';
import { unicodeGlyphs } from './unicodeShader';
import './unicode-preview.css';

const initial = { cellSize: 12, glow: 1, spread: 1, speed: .65, background: 1 };

export default function UnicodePreview() {
  const [settings, setSettings] = useState(initial);
  const [paused, setPaused] = useState(false);
  const [wide, setWide] = useState(false);
  const spread = settings.spread ?? initial.spread;
  const stage = useRef<HTMLDivElement>(null);
  const adjust = (key: keyof typeof initial, value: number) =>
    setSettings(previous => ({ ...previous, [key]: value }));

  return <main className="unicode-lab">
    <header className="unicode-header"><a href="/unicode-preview.html">▦ <span>No Type</span></a>
      <span>SHADER STUDIES <i>/</i> 01</span><span className="unicode-local">Локальный эксперимент</span></header>
    <div className="unicode-layout">
      <section className="unicode-stage" ref={stage} data-wide={wide} aria-label="Живое превью шейдера">
        <UnicodeField {...settings} spread={spread} paused={paused} />
        <div className="unicode-stage-top"><span>UNICODE FIELD</span><span>01 — CYAN / VIOLET</span></div>
        <div className="unicode-stage-bottom"><span>{paused ? 'Кадр зафиксирован' : 'Живое цветовое поле'}</span>
          <button aria-label="Открыть эффект на весь экран" onClick={() => { void stage.current?.requestFullscreen(); }}>↗</button></div>
      </section>
      <aside className="unicode-panel">
        <p className="unicode-eyebrow">СВЕТ × СИМВОЛЫ</p>
        <h1>Unicode<br />как материал.</h1>
        <p className="unicode-description">Мягкий градиент превращается в сетку. Чем ярче свет, тем плотнее символ.</p>
        <div className="unicode-glyphs" aria-label="Символы от разреженных к плотным">{unicodeGlyphs.map(character => <span key={character}>{character}</span>)}</div>
        <div className="unicode-controls">
          <label><span>Размер ячейки<output>{settings.cellSize} px</output></span><input aria-label="Размер ячейки" type="range" min="8" max="26" step="1" value={settings.cellSize} onChange={event => adjust('cellSize', Number(event.target.value))} /></label>
          <label><span>Свечение<output>{Math.round(settings.glow * 100)}%</output></span><input aria-label="Свечение" type="range" min="0" max="2" step=".05" value={settings.glow} onChange={event => adjust('glow', Number(event.target.value))} /></label>
          <label><span>Радиус свечения<output>{spread.toFixed(1)}×</output></span><input aria-label="Радиус свечения" type="range" min=".3" max="3" step=".1" value={spread} onChange={event => adjust('spread', Number(event.target.value))} /></label>
          <label><span>Мягкий фон<output>{Math.round(settings.background * 100)}%</output></span><input aria-label="Мягкий фон" type="range" min="0" max="4" step=".1" value={settings.background} onChange={event => adjust('background', Number(event.target.value))} /></label>
          <label><span>Скорость<output>{settings.speed.toFixed(2)}×</output></span><input aria-label="Скорость" type="range" min="0" max="2" step=".05" value={settings.speed} onChange={event => adjust('speed', Number(event.target.value))} /></label>
        </div>
        <div className="unicode-format" role="group" aria-label="Формат превью"><button aria-pressed={!wide} onClick={() => setWide(false)}>4:5</button><button aria-pressed={wide} onClick={() => setWide(true)}>Широкий</button></div>
        <div className="unicode-actions"><button className="unicode-pause" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? '▶ Продолжить' : 'Ⅱ Пауза'}</button><button onClick={() => { setSettings(initial); setPaused(false); setWide(false); }}>Сбросить</button></div>
      </aside>
    </div>
  </main>;
}
