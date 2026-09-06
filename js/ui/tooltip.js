import { t } from '../i18n.js';

/**
 * Ayuda contextual: un botón «i» junto a cada concepto.
 *
 * Se usa un tooltip propio y no el atributo `title` nativo porque este tarda
 * casi un segundo en aparecer, no se puede dar estilo, corta los textos largos
 * y no existe en pantallas táctiles. Aquí los textos son de varias frases y
 * tienen que poder leerse con calma.
 *
 * El contenido se busca en el momento de mostrarlo, no al crear el botón: así
 * cambiar de idioma no obliga a reconstruir nada.
 */
let tip = null;
let openFor = null;

function ensure() {
  if (tip) return tip;
  tip = document.createElement('div');
  tip.className = 'tip';
  tip.id = 'tg-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.appendChild(tip);
  return tip;
}

function show(btn) {
  const key = btn.dataset.info;
  if (!key) return;
  const el = ensure();
  el.textContent = t(key);
  el.hidden = false;
  openFor = btn;
  btn.setAttribute('aria-describedby', el.id);
  btn.classList.add('open');

  // Posición: debajo y centrado; arriba si no cabe, y siempre dentro del ancho
  // de la ventana.
  const r = btn.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  const margin = 8;
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - margin) top = Math.max(margin, r.top - h - 6);
  el.style.left = `${Math.round(left + window.scrollX)}px`;
  el.style.top = `${Math.round(top + window.scrollY)}px`;
}

function hide() {
  if (!tip) return;
  tip.hidden = true;
  if (openFor) {
    openFor.removeAttribute('aria-describedby');
    openFor.classList.remove('open');
    openFor = null;
  }
}

/** Etiquetas accesibles al vuelo, para cuando cambia el idioma. */
export function refreshTooltips(root = document) {
  for (const b of root.querySelectorAll('button.info')) {
    b.setAttribute('aria-label', t('info.more'));
  }
  if (openFor) show(openFor);
}

export function initTooltips() {
  const isInfo = (e) => e.target.closest && e.target.closest('button.info');

  document.addEventListener('pointerover', (e) => {
    const b = isInfo(e);
    if (b && b !== openFor) show(b);
  });
  document.addEventListener('pointerout', (e) => {
    const b = isInfo(e);
    if (b && b === openFor && !b.matches(':focus-visible')) hide();
  });
  // El clic alterna: es la única vía en pantallas táctiles, donde no hay hover.
  document.addEventListener('click', (e) => {
    const b = isInfo(e);
    if (!b) { hide(); return; }
    e.preventDefault();
    if (b === openFor) hide(); else show(b);
  });
  document.addEventListener('focusin', (e) => {
    const b = isInfo(e);
    if (b) show(b); else if (openFor && !openFor.contains(e.target)) hide();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', hide, { passive: true });
  window.addEventListener('resize', hide);
}
