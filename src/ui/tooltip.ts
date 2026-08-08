/**
 * Tooltips: one component, one structured payload.
 *
 * `docs/research/cs2/ux-conventions.md` §5 is explicit that the reference game's
 * tooltip is "hover-anything, get a structured card" and that the discipline to
 * copy is *every number decomposes into its inputs*. Its v1 adoption note is
 * equally explicit that this must be **one component with a structured payload,
 * not ad-hoc `title` attributes** — because the moment it is a `title` string,
 * the breakdown rows stop being possible and the rule quietly dies.
 *
 * So: a single floating card, one per HUD, anchored to whichever element the
 * pointer (or the keyboard focus) is on. Content is supplied lazily through a
 * callback, so a tooltip that reports live figures reads them at hover time
 * without the HUD recomputing anything per frame (guardrail 10: a hover must
 * never trigger a whole-city pass — the callbacks below only read cached
 * aggregates).
 *
 * Keyboard parity is not decoration here: the same card opens on `focus`, so a
 * player tabbing the toolbar gets the costs a mouse player gets.
 */

/** One `label: value` line of a tooltip's breakdown. */
export interface TooltipRow {
  label: string;
  value: string;
  /** Renders the value in the warning colour, for a cost that cannot be met. */
  warn?: boolean;
}

/** The structured payload a tooltip renders. */
export interface TooltipContent {
  /** Headline — the name of the thing being hovered. */
  title: string;
  /** One-line qualifier under the title, e.g. a category or a shortcut. */
  subtitle?: string;
  /** The decomposition: costs, upkeep, current values. */
  rows?: readonly TooltipRow[];
  /** Closing sentence explaining what the thing does or why it is disabled. */
  note?: string;
}

/** Produces a payload at hover time. Return `null` to suppress the tooltip. */
export type TooltipSource = () => TooltipContent | null;

/** Pixels of clearance between the anchor and the card. */
const GAP = 10;

/** Pixels of clearance kept between the card and the viewport edge. */
const MARGIN = 8;

/**
 * The HUD's single tooltip card.
 *
 * One instance is created by {@link Hud} and shared by every control; binding a
 * new element costs two listeners and no DOM.
 */
export class TooltipLayer {
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly subtitleEl: HTMLElement;
  private readonly rowsEl: HTMLElement;
  private readonly noteEl: HTMLElement;

  /** Element the card is currently describing, or `null` when hidden. */
  private anchor: HTMLElement | null = null;

  /** Sources keyed by the element they belong to. */
  private readonly sources = new WeakMap<HTMLElement, TooltipSource>();

  /** @param mount Element the card is appended to, typically the HUD root. */
  constructor(mount: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud-tip';
    this.root.setAttribute('role', 'tooltip');
    this.root.hidden = true;

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'hud-tip__title';
    this.subtitleEl = document.createElement('div');
    this.subtitleEl.className = 'hud-tip__subtitle';
    this.rowsEl = document.createElement('div');
    this.rowsEl.className = 'hud-tip__rows';
    this.noteEl = document.createElement('div');
    this.noteEl.className = 'hud-tip__note';

    this.root.append(this.titleEl, this.subtitleEl, this.rowsEl, this.noteEl);
    mount.append(this.root);
  }

  /** The card element, for tests and for layout measurement. */
  get element(): HTMLElement {
    return this.root;
  }

  /** True while a card is on screen. */
  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Element the open card describes, or `null`. */
  get anchorElement(): HTMLElement | null {
    return this.root.hidden ? null : this.anchor;
  }

  /**
   * Attach a tooltip to a control.
   *
   * Both pointer and focus open it, which is the whole of this component's
   * accessibility story: any control reachable by Tab explains itself.
   *
   * @param element Control to describe.
   * @param source Called at hover time to build the payload.
   */
  bind(element: HTMLElement, source: TooltipSource): void {
    this.sources.set(element, source);
    element.addEventListener('pointerenter', () => this.open(element));
    element.addEventListener('pointerleave', () => this.closeIf(element));
    element.addEventListener('focus', () => this.open(element));
    element.addEventListener('blur', () => this.closeIf(element));
  }

  /**
   * Show the card for a bound element, rebuilding its payload.
   *
   * @returns `true` when a card was shown. A source returning `null` hides it.
   */
  open(element: HTMLElement): boolean {
    const source = this.sources.get(element);
    if (!source) return false;
    const content = source();
    if (!content) {
      this.closeIf(element);
      return false;
    }
    this.anchor = element;
    this.render(content);
    this.root.hidden = false;
    this.position(element);
    return true;
  }

  /** Hide the card. */
  close(): void {
    this.root.hidden = true;
    this.anchor = null;
  }

  /** Hide the card only if it currently belongs to this element. */
  closeIf(element: HTMLElement): void {
    if (this.anchor === element) this.close();
  }

  /** Rebuild the open card's content in place, e.g. after a state change. */
  refresh(): void {
    if (this.anchor) this.open(this.anchor);
  }

  /** Remove the card from the DOM. */
  dispose(): void {
    this.root.remove();
  }

  private render(content: TooltipContent): void {
    this.titleEl.textContent = content.title;

    this.subtitleEl.textContent = content.subtitle ?? '';
    this.subtitleEl.hidden = !content.subtitle;

    this.rowsEl.replaceChildren();
    const rows = content.rows ?? [];
    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'hud-tip__row';
      const label = document.createElement('span');
      label.className = 'hud-tip__label';
      label.textContent = row.label;
      const value = document.createElement('span');
      value.className = row.warn ? 'hud-tip__value is-warning' : 'hud-tip__value';
      value.textContent = row.value;
      line.append(label, value);
      this.rowsEl.append(line);
    }
    this.rowsEl.hidden = rows.length === 0;

    this.noteEl.textContent = content.note ?? '';
    this.noteEl.hidden = !content.note;
  }

  /**
   * Place the card above its anchor, flipping below and clamping horizontally
   * rather than letting it run off screen.
   *
   * jsdom reports every rect as zero, so the arithmetic has to be harmless at
   * zero rather than guarded by a `typeof window` check — which it is: a card
   * with no measurable size simply lands at the margin.
   */
  private position(element: HTMLElement): void {
    const anchor = element.getBoundingClientRect();
    const card = this.root.getBoundingClientRect();
    const viewWidth = window.innerWidth || 0;
    const viewHeight = window.innerHeight || 0;

    let left = anchor.left + anchor.width / 2 - card.width / 2;
    const maxLeft = Math.max(MARGIN, viewWidth - card.width - MARGIN);
    left = Math.min(Math.max(left, MARGIN), maxLeft);

    let top = anchor.top - card.height - GAP;
    if (top < MARGIN) {
      const below = anchor.bottom + GAP;
      top = below + card.height + MARGIN > viewHeight ? MARGIN : below;
    }

    this.root.style.left = `${Math.round(left)}px`;
    this.root.style.top = `${Math.round(top)}px`;
  }
}
