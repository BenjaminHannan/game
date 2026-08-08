/**
 * @vitest-environment jsdom
 *
 * The UI shell: toolbar structure, tooltips, the info-view mode, and toasts.
 *
 * These are structural assertions, not pixel ones. What they pin is the set of
 * rules `docs/research/cs2/ux-conventions.md` says carry the feel: three stable
 * levels in the toolbar, locked entries visible rather than hidden, one tooltip
 * component that opens on focus as well as hover, and info views as a mode over
 * the world with exactly one active at a time.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '../src/core/engine.js';
import { Simulation } from '../src/sim/state.js';
import { SelectTool, ToolManager } from '../src/input/tools.js';
import { Hud } from '../src/ui/hud.js';
import { InfoViewManager } from '../src/ui/infoViews.js';
import { NotificationCenter, MAX_TOASTS, COALESCE_WINDOW_MS } from '../src/ui/notifications.js';
import { TooltipLayer } from '../src/ui/tooltip.js';
import { hasIcon, icon } from '../src/ui/icons.js';

const mounts: HTMLElement[] = [];
const huds: Hud[] = [];

function makeHud(): { hud: Hud; mount: HTMLElement; sim: Simulation; tools: ToolManager } {
  const mount = document.createElement('div');
  document.body.append(mount);
  mounts.push(mount);
  const sim = new Simulation(31337);
  const tools = new ToolManager();
  tools.register(new SelectTool());
  const hud = new Hud(mount, new Engine(), sim.state, tools);
  huds.push(hud);
  return { hud, mount, sim, tools };
}

afterEach(() => {
  while (huds.length > 0) (huds.pop() as Hud).dispose();
  while (mounts.length > 0) (mounts.pop() as HTMLElement).remove();
});

describe('icons', () => {
  it('renders self-contained inline SVG that inherits the button colour', () => {
    const markup = icon('roads', 20);
    expect(markup.startsWith('<svg')).toBe(true);
    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain('width="20"');
    expect(markup).toContain('currentColor');
    // Decorative: the button's own label is the accessible name.
    expect(markup).toContain('aria-hidden="true"');
    // Nothing is fetched — the whole set is markup, so the HUD has no assets.
    expect(markup).not.toContain('http');
  });

  it('answers honestly about which glyphs it ships', () => {
    expect(hasIcon('bulldoze')).toBe(true);
    expect(hasIcon('nonesuch')).toBe(false);
  });
});

describe('toolbar', () => {
  it('shows the live categories and keeps the locked ones visible but disabled', () => {
    const { mount } = makeHud();
    const buttons = [...mount.querySelectorAll('button.hud-tool')] as HTMLButtonElement[];
    expect(buttons.map((b) => b.dataset.tool)).toEqual([
      'select',
      'roads',
      'zones',
      'bulldoze',
      'power',
      'water',
      'services',
    ]);
    // Locked entries stay visible so the toolbar reads as a promise — and they
    // are aria-disabled rather than `disabled`, so they stay tabbable and can
    // still explain themselves on hover, which is the only reason to show them.
    for (const id of ['power', 'water', 'services']) {
      const btn = mount.querySelector(`button.hud-tool[data-tool="${id}"]`) as HTMLButtonElement;
      expect(btn.dataset.locked).toBe('true');
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.disabled).toBe(false);
      expect(btn.classList.contains('is-locked')).toBe(true);
    }
    for (const id of ['select', 'roads', 'zones', 'bulldoze']) {
      const btn = mount.querySelector(`button.hud-tool[data-tool="${id}"]`) as HTMLButtonElement;
      expect(btn.dataset.locked).toBeUndefined();
    }
  });

  it('does nothing when a locked category is clicked', () => {
    const { mount, hud } = makeHud();
    const power = mount.querySelector('button.hud-tool[data-tool="power"]') as HTMLButtonElement;
    power.click();
    expect(power.classList.contains('is-active')).toBe(false);
    expect(hud.visibleToolModes).toBeNull();
    expect(
      (mount.querySelector('button.hud-tool[data-tool="select"]') as HTMLElement).classList
        .contains('is-active'),
    ).toBe(true);
  });

  it('gives every category an icon and a label, and the bulldozer its own styling', () => {
    const { mount } = makeHud();
    for (const btn of mount.querySelectorAll('button.hud-tool')) {
      expect(btn.querySelector('.hud-tool__icon svg')).not.toBeNull();
      expect((btn.querySelector('.hud-tool__label') as HTMLElement).textContent).toBeTruthy();
    }
    const bulldoze = mount.querySelector('button.hud-tool[data-tool="bulldoze"]') as HTMLElement;
    expect(bulldoze.classList.contains('hud-tool--destructive')).toBe(true);
  });

  it('tracks the armed tool in the class and in aria-pressed', () => {
    const { mount, hud, tools } = makeHud();
    hud.registerToolModes(
      'roads',
      [{ id: 'small', label: 'Two-Lane', onSelect: () => {} }],
      'small',
    );
    const select = mount.querySelector('button.hud-tool[data-tool="select"]') as HTMLButtonElement;
    const roads = mount.querySelector('button.hud-tool[data-tool="roads"]') as HTMLButtonElement;

    expect(select.getAttribute('aria-pressed')).toBe('true');
    roads.click();
    expect(roads.classList.contains('is-active')).toBe(true);
    expect(roads.getAttribute('aria-pressed')).toBe('true');
    expect(select.getAttribute('aria-pressed')).toBe('false');
    // No road tool is registered here, so the manager falls back to select
    // while the button still lights up — the toolbar leads, the manager follows.
    expect(tools.current?.id).toBe('select');
  });

  it('shows only the active category options row, and keeps its choice across switches', () => {
    const { mount, hud } = makeHud();
    const picked: string[] = [];
    hud.registerToolModes(
      'zones',
      [
        { id: 'residential', label: 'Residential', onSelect: () => picked.push('residential') },
        { id: 'industrial', label: 'Industrial', onSelect: () => picked.push('industrial') },
      ],
      'residential',
    );
    hud.registerToolModes(
      'bulldoze',
      [{ id: 'all', label: 'Anything', onSelect: () => picked.push('all') }],
      'all',
    );

    expect(hud.visibleToolModes).toBeNull();
    (mount.querySelector('button.hud-tool[data-tool="zones"]') as HTMLButtonElement).click();
    expect(hud.visibleToolModes).toBe('zones');

    const industrial = mount.querySelector(
      'button.hud-mode[data-tool="zones"][data-mode="industrial"]',
    ) as HTMLButtonElement;
    industrial.click();
    expect(picked).toEqual(['industrial']);
    expect(industrial.getAttribute('aria-pressed')).toBe('true');

    // Level three persists across a change at level one — the whole point of
    // keeping "what" and "how" independent.
    (mount.querySelector('button.hud-tool[data-tool="bulldoze"]') as HTMLButtonElement).click();
    expect(hud.visibleToolModes).toBe('bulldoze');
    (mount.querySelector('button.hud-tool[data-tool="zones"]') as HTMLButtonElement).click();
    expect(industrial.classList.contains('is-active')).toBe(true);
  });

  it('arms tools from the keyboard without touching the mouse', () => {
    const { mount } = makeHud();
    const press = (code: string): void => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    };
    press('KeyB');
    expect(
      (mount.querySelector('button.hud-tool[data-tool="bulldoze"]') as HTMLElement).classList
        .contains('is-active'),
    ).toBe(true);
    press('KeyR');
    expect(
      (mount.querySelector('button.hud-tool[data-tool="roads"]') as HTMLElement).classList
        .contains('is-active'),
    ).toBe(true);
    press('KeyV');
    expect(
      (mount.querySelector('button.hud-tool[data-tool="select"]') as HTMLElement).classList
        .contains('is-active'),
    ).toBe(true);
  });

  it('leaves modified chords and typing in fields to the browser', () => {
    const { mount } = makeHud();
    const field = document.createElement('input');
    document.body.append(field);
    field.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', ctrlKey: true }));
    expect(
      (mount.querySelector('button.hud-tool[data-tool="bulldoze"]') as HTMLElement).classList
        .contains('is-active'),
    ).toBe(false);
    field.remove();
  });

  it('hides the whole overlay on the backtick key', () => {
    const { mount, hud } = makeHud();
    expect(hud.chromeShown).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backquote' }));
    expect(hud.chromeShown).toBe(false);
    expect((mount.querySelector('.hud') as HTMLElement).classList.contains('is-hidden')).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backquote' }));
    expect(hud.chromeShown).toBe(true);
  });
});

describe('tooltips', () => {
  it('opens a structured card on hover and closes it on leave', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const tips = new TooltipLayer(mount);
    const button = document.createElement('button');
    mount.append(button);
    tips.bind(button, () => ({
      title: 'Two-Lane Road',
      subtitle: 'Road class',
      rows: [
        { label: 'Construction', value: '¤2 / m' },
        { label: 'Upkeep', value: '¤0.16 / m / month', warn: true },
      ],
      note: 'Emits zoning cells along both verges.',
    }));

    expect(tips.isOpen).toBe(false);
    button.dispatchEvent(new Event('pointerenter'));
    expect(tips.isOpen).toBe(true);
    expect(tips.element.querySelector('.hud-tip__title')?.textContent).toBe('Two-Lane Road');
    const rows = tips.element.querySelectorAll('.hud-tip__row');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.querySelector('.hud-tip__value')?.classList.contains('is-warning')).toBe(true);
    expect(tips.element.querySelector('.hud-tip__note')?.textContent).toContain('verges');

    button.dispatchEvent(new Event('pointerleave'));
    expect(tips.isOpen).toBe(false);
    tips.dispose();
    mount.remove();
  });

  it('opens on focus too, so the keyboard gets the same costs the mouse does', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const tips = new TooltipLayer(mount);
    const button = document.createElement('button');
    mount.append(button);
    tips.bind(button, () => ({ title: 'Bulldoze' }));

    button.dispatchEvent(new Event('focus'));
    expect(tips.isOpen).toBe(true);
    expect(tips.anchorElement).toBe(button);
    button.dispatchEvent(new Event('blur'));
    expect(tips.isOpen).toBe(false);
    tips.dispose();
    mount.remove();
  });

  it('rebuilds its payload at hover time rather than caching it', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const tips = new TooltipLayer(mount);
    const button = document.createElement('button');
    mount.append(button);
    let money = 100;
    tips.bind(button, () => ({ title: `¤ ${money}` }));

    button.dispatchEvent(new Event('pointerenter'));
    expect(tips.element.querySelector('.hud-tip__title')?.textContent).toBe('¤ 100');
    money = 250;
    tips.refresh();
    expect(tips.element.querySelector('.hud-tip__title')?.textContent).toBe('¤ 250');
    tips.dispose();
    mount.remove();
  });

  it('lets a source suppress its own card by returning null', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const tips = new TooltipLayer(mount);
    const button = document.createElement('button');
    mount.append(button);
    tips.bind(button, () => null);
    expect(tips.open(button)).toBe(false);
    expect(tips.isOpen).toBe(false);
    tips.dispose();
    mount.remove();
  });

  it('decomposes the treasury and the demand bars rather than showing bare numbers', () => {
    const { mount, hud, sim } = makeHud();
    sim.ledger.pay(400, 'roadUpkeep');
    sim.ledger.earn(100, 'tax');
    sim.ledger.settle();
    hud.update(100);

    const money = mount.querySelector('.hud-stat[data-stat="treasury"]') as HTMLElement;
    money.dispatchEvent(new Event('pointerenter'));
    const card = hud.tooltips.element;
    expect(card.hidden).toBe(false);
    expect(card.textContent).toContain('Last month, net');
    expect(card.textContent).toContain('-¤ 300 / mo');

    const demand = mount.querySelector('.hud-demand__column[data-zone="r"]') as HTMLElement;
    demand.dispatchEvent(new Event('pointerenter'));
    expect(card.textContent).toContain('Residential demand');
    expect(card.textContent).toContain('readout of the market');
  });

  it('explains a locked category instead of leaving it mute', () => {
    const { mount, hud } = makeHud();
    const power = mount.querySelector('button.hud-tool[data-tool="power"]') as HTMLElement;
    power.dispatchEvent(new Event('pointerenter'));
    expect(hud.tooltips.element.textContent).toContain('Not available yet');
    expect(hud.tooltips.element.textContent).toContain('utilities milestone');
  });
});

describe('info views', () => {
  it('activates exactly one at a time and calls apply once per transition', () => {
    const views = new InfoViewManager();
    const log: string[] = [];
    views.register({
      id: 'traffic',
      label: 'Traffic',
      icon: 'traffic',
      description: 'Flow over capacity.',
      apply: (on) => log.push(`traffic:${on}`),
    });
    views.register({
      id: 'zones',
      label: 'Zones',
      icon: 'zones',
      description: 'Painted cells.',
      apply: (on) => log.push(`zones:${on}`),
    });

    expect(views.active).toBeNull();
    views.setActive('traffic');
    expect(views.active).toBe('traffic');
    views.setActive('traffic');
    expect(log).toEqual(['traffic:true']);

    views.setActive('zones');
    expect(log).toEqual(['traffic:true', 'traffic:false', 'zones:true']);
    views.clear();
    expect(views.active).toBeNull();
    expect(log[log.length - 1]).toBe('zones:false');
  });

  it('refuses a locked view rather than silently ignoring it', () => {
    const views = new InfoViewManager();
    views.register({
      id: 'landvalue',
      label: 'Land value',
      icon: 'landvalue',
      description: 'Reserved.',
      available: false,
    });
    expect(views.isAvailable('landvalue')).toBe(false);
    expect(views.setActive('landvalue')).toBe(false);
    expect(views.active).toBeNull();
  });

  it('toggles off when the lit view is picked again', () => {
    const views = new InfoViewManager();
    views.register({ id: 'a', label: 'A', icon: 'info', description: '' });
    expect(views.toggle('a')).toBe('a');
    expect(views.toggle('a')).toBeNull();
  });

  it('renders an opener per view and a panel with the metric and the legend', () => {
    const { mount, hud } = makeHud();
    const views = new InfoViewManager();
    let flow = 0;
    views.register({
      id: 'traffic',
      label: 'Traffic',
      icon: 'traffic',
      description: 'Per-edge volume over capacity.',
      legend: [
        { color: '#3b3d44', label: 'Free flowing' },
        { color: '#d1483c', label: 'At capacity' },
      ],
      metric: () => ({ value: `${flow}%`, label: 'worst road', note: 'One pass per day.' }),
    });
    views.register({
      id: 'landvalue',
      label: 'Land value',
      icon: 'landvalue',
      description: 'Reserved.',
      available: false,
      lockedNote: 'Arrives with services.',
    });
    hud.attachInfoViews(views);

    const openers = [...mount.querySelectorAll('button.hud-view')] as HTMLButtonElement[];
    expect(openers.map((b) => b.dataset.view)).toEqual(['traffic', 'landvalue']);
    expect(openers[1]?.getAttribute('aria-disabled')).toBe('true');
    // Clicking a locked opener changes nothing.
    (openers[1] as HTMLButtonElement).click();
    expect(views.active).toBeNull();

    const panel = mount.querySelector('.hud-infopanel') as HTMLElement;
    expect(panel.hidden).toBe(true);

    (openers[0] as HTMLButtonElement).click();
    expect(views.active).toBe('traffic');
    expect(openers[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(panel.hidden).toBe(false);
    expect(panel.dataset.view).toBe('traffic');
    expect(panel.querySelector('.hud-infopanel__value')?.textContent).toBe('0%');
    expect(mount.querySelectorAll('.hud-legend__stop')).toHaveLength(2);
    // The mode is on the HUD root too, so world-level CSS can read it.
    expect((mount.querySelector('.hud') as HTMLElement).dataset.infoView).toBe('traffic');

    // The panel refreshes from the live metric on the frame tick, not on click.
    flow = 140;
    hud.update(100);
    expect(panel.querySelector('.hud-infopanel__value')?.textContent).toBe('140%');

    // Escape backs out of the mode.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    expect(views.active).toBeNull();
    expect(panel.hidden).toBe(true);
  });
});

describe('notifications', () => {
  it('renders a toast with its severity, and dismisses it on the close button', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const toasts = new NotificationCenter(mount);
    const id = toasts.push({ title: 'Month settled', body: 'Net +¤1,200', kind: 'success' });
    expect(toasts.count).toBe(1);

    const node = mount.querySelector(`.hud-toast[data-toast-id="${id}"]`) as HTMLElement;
    expect(node.dataset.kind).toBe('success');
    expect(node.querySelector('.hud-toast__title')?.textContent).toContain('Month settled');
    expect(node.querySelector('.hud-toast__body')?.textContent).toBe('Net +¤1,200');
    expect(node.querySelector('.hud-toast__icon svg')).not.toBeNull();

    (node.querySelector('.hud-toast__close') as HTMLButtonElement).click();
    expect(toasts.count).toBe(0);
    toasts.dispose();
    mount.remove();
  });

  it('coalesces a repeat instead of stacking duplicates', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    let now = 1000;
    const toasts = new NotificationCenter(mount, () => now);

    const first = toasts.push({ title: 'Not enough funds', kind: 'warning' });
    now += 100;
    const second = toasts.push({ title: 'Not enough funds', kind: 'warning' });
    expect(second).toBe(first);
    expect(toasts.count).toBe(1);
    expect(toasts.active[0]?.count).toBe(2);
    expect(mount.querySelector('.hud-toast__count')?.textContent).toBe('x2');

    // Past the window it is a new event again, and deserves its own toast.
    now += COALESCE_WINDOW_MS + 1;
    const third = toasts.push({ title: 'Not enough funds', kind: 'warning' });
    expect(third).not.toBe(first);
    expect(toasts.count).toBe(2);
    toasts.dispose();
    mount.remove();
  });

  it('drops the oldest past the cap so the corner never fills up', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const toasts = new NotificationCenter(mount);
    for (let i = 0; i < MAX_TOASTS + 3; i++) toasts.push({ title: `Event ${i}` });
    expect(toasts.count).toBe(MAX_TOASTS);
    expect(toasts.active[0]?.title).toBe(`Event ${3}`);
    toasts.dispose();
    mount.remove();
  });

  it('expires on its own schedule, and a pinned toast never does', () => {
    vi.useFakeTimers();
    const mount = document.createElement('div');
    document.body.append(mount);
    const toasts = new NotificationCenter(mount);
    toasts.push({ title: 'Transient', ttl: 1000 });
    toasts.push({ title: 'Pinned', ttl: 0 });
    expect(toasts.count).toBe(2);
    vi.advanceTimersByTime(1500);
    expect(toasts.count).toBe(1);
    expect(toasts.active[0]?.title).toBe('Pinned');
    toasts.dispose();
    mount.remove();
    vi.useRealTimers();
  });

  it('is reachable from the HUD, and announced politely rather than assertively', () => {
    const { mount, hud } = makeHud();
    hud.notify({ title: 'Removed two-lane road', body: 'refunded ¤100' });
    expect(mount.querySelectorAll('.hud-toast')).toHaveLength(1);
    const area = mount.querySelector('.hud-toasts') as HTMLElement;
    expect(area.getAttribute('aria-live')).toBe('polite');
  });
});
