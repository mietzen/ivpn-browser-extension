/**
 * Reusable server-picker combobox. Trigger button shows the current
 * value; clicking opens a popover with Quick Pick (most-used servers
 * as chips), a search input, and the full grouped server list.
 *
 * Used by both the Global and Current Website sections in the popup.
 *
 * Vanilla DOM — no framework. The same component instance is reused;
 * call `setOptions({...})` to swap content per section.
 */

import type { IvpnServer } from '~/lib/ivpn/types';
import { groupActiveServers, searchGroups, type ServerGroup } from '~/lib/ivpn/grouping';
import type { ServerHistoryEntry } from '~/lib/storage';
import type { GlobalProxy } from '~/lib/proxy/rules';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Optional group label for visual separation. */
  group?: string;
  /** Sub-label (e.g. "Buenos Aires · 16%"). */
  hint?: string;
  /** Rendered as a read-only row (e.g. the current socks5 marker). */
  disabled?: boolean;
}

export interface ComboboxConfig {
  options: ComboboxOption[];
  history: Record<string, ServerHistoryEntry>;
  servers: IvpnServer[];
  placeholder: string;
  emptyText: string;
  onSelect: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
}

export class ServerCombobox {
  private root: HTMLElement;
  private trigger: HTMLButtonElement;
  private popover: HTMLElement;
  private quickPickEl: HTMLElement;
  private searchInput: HTMLInputElement;
  private listEl: HTMLElement;
  private valueEl: HTMLElement;
  private currentValue: string | null = null;
  private config: ComboboxConfig | null = null;
  private isOpen = false;
  private pendingOpen = false;
  private outsideHandler: ((e: MouseEvent) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'combobox';

    this.trigger = document.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = 'combobox-trigger';

    this.valueEl = document.createElement('span');
    this.valueEl.className = 'combobox-value';
    this.trigger.appendChild(this.valueEl);
    this.trigger.appendChild(this.makeChevron());

    this.popover = document.createElement('div');
    this.popover.className = 'combobox-popover';
    this.popover.setAttribute('role', 'listbox');
    this.popover.hidden = true;

    this.quickPickEl = document.createElement('div');
    this.quickPickEl.className = 'combobox-quickpick';
    this.popover.appendChild(this.quickPickEl);

    const searchWrap = document.createElement('div');
    searchWrap.className = 'combobox-search';
    this.searchInput = document.createElement('input');
    this.searchInput.type = 'search';
    this.searchInput.placeholder = 'Search country, city, or gateway';
    this.searchInput.autocomplete = 'off';
    searchWrap.appendChild(this.searchInput);
    this.popover.appendChild(searchWrap);

    this.listEl = document.createElement('div');
    this.listEl.className = 'combobox-list';
    this.popover.appendChild(this.listEl);

    this.root.appendChild(this.trigger);
    this.root.appendChild(this.popover);

    this.trigger.addEventListener('click', () => this.toggle());
    this.searchInput.addEventListener('input', () => this.renderList());
    this.searchInput.addEventListener('keydown', (e) => this.onSearchKey(e));
  }

  setOptions(config: ComboboxConfig): void {
    this.config = config;
    this.searchInput.value = '';
    this.renderAll();
    if (this.pendingOpen) {
      this.pendingOpen = false;
      this.open();
    }
  }

  setValue(value: string | null): void {
    this.currentValue = value;
    this.renderTrigger();
  }

  getValue(): string | null {
    return this.currentValue;
  }

  destroy(): void {
    this.close();
    this.root.remove();
  }

  get element(): HTMLElement {
    return this.root;
  }

  private makeChevron(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'combobox-chevron';
    span.textContent = '▾';
    return span;
  }

  private toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private open(): void {
    if (!this.config) {
      this.pendingOpen = true;
      return;
    }
    this.isOpen = true;
    this.popover.hidden = false;
    this.config.onOpenChange?.(true);
    this.fitPopover();
    this.renderList();
    this.searchInput.focus();
    this.outsideHandler = (e) => {
      if (!this.root.contains(e.target as Node)) this.close();
    };
    this.keyHandler = (e) => {
      if (e.key === 'Escape') this.close();
    };
    document.addEventListener('mousedown', this.outsideHandler);
    document.addEventListener('keydown', this.keyHandler);
  }

  private close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.popover.hidden = true;
    this.popover.style.maxHeight = '';
    this.config?.onOpenChange?.(false);
    if (this.outsideHandler) {
      document.removeEventListener('mousedown', this.outsideHandler);
      this.outsideHandler = null;
    }
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
  }

  private fitPopover(): void {
    // 600px is the max popup window height in Chrome and Firefox. The body
    // is forced to exactly 600px while a combobox is open (see
    // html.combobox-open in style.css), so sizing against that constant is
    // deterministic — no need to wait for the window to actually resize.
    const rect = this.trigger.getBoundingClientRect();
    const available = 600 - rect.bottom - 8;
    this.popover.style.maxHeight = `${Math.max(120, available)}px`;
  }

  private renderAll(): void {
    this.renderTrigger();
    this.renderQuickPick();
    this.renderList();
  }

  private renderTrigger(): void {
    if (!this.config) return;
    const opt = this.config.options.find((o) => o.value === this.currentValue);
    const server = opt
      ? undefined
      : this.config.servers.find((s) => s.gateway === this.currentValue);
    this.valueEl.textContent = opt?.label ?? server?.gateway ?? this.config.placeholder;
    this.trigger.classList.toggle('is-set', !!opt || !!server);
  }

  private renderQuickPick(): void {
    if (!this.config) return;
    this.quickPickEl.innerHTML = '';
    const entries = Object.values(this.config.history)
      .sort((a, b) => b.lastUsed - a.lastUsed)
      .slice(0, 5);
    if (entries.length === 0) {
      this.quickPickEl.hidden = true;
      return;
    }
    this.quickPickEl.hidden = false;
    const label = document.createElement('div');
    label.className = 'combobox-section-label';
    label.textContent = 'Quick Pick';
    this.quickPickEl.appendChild(label);
    const chips = document.createElement('div');
    chips.className = 'combobox-chips';
    for (const entry of entries) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'combobox-chip';
      chip.textContent = entry.gateway;
      chip.addEventListener('click', () => this.select(entry.gateway));
      chips.appendChild(chip);
    }
    this.quickPickEl.appendChild(chips);
  }

  private renderList(): void {
    if (!this.config) return;
    this.listEl.innerHTML = '';
    const q = this.searchInput.value.trim().toLowerCase();
    if (q) {
      const groups = groupActiveServers(this.config.servers);
      const filtered = searchGroups(groups, q);
      this.renderGroups(filtered);
      return;
    }
    this.renderSpecialOptions();
    const groups = groupActiveServers(this.config.servers);
    this.renderGroups(groups);
  }

  private renderSpecialOptions(): void {
    if (!this.config) return;
    for (const opt of this.config.options) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'combobox-server combobox-special';
      if (opt.disabled) row.disabled = true;
      if (opt.value === this.currentValue) row.classList.add('selected');
      row.textContent = opt.label;
      if (opt.hint) {
        const hint = document.createElement('span');
        hint.className = 'combobox-load';
        hint.textContent = opt.hint;
        row.appendChild(hint);
      }
      row.addEventListener('click', () => this.select(opt.value));
      this.listEl.appendChild(row);
    }
  }

  private renderGroups(groups: ServerGroup[]): void {
    for (const group of groups) {
      const country = document.createElement('div');
      country.className = 'combobox-country';
      country.textContent = `${group.country} (${group.countryCode})`;
      this.listEl.appendChild(country);
      for (const city of group.cities) {
        const cityEl = document.createElement('div');
        cityEl.className = 'combobox-city';
        cityEl.textContent = city.city;
        this.listEl.appendChild(cityEl);
        for (const server of city.servers) {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'combobox-server';
          if (server.gateway === this.currentValue) row.classList.add('selected');
          row.textContent = server.gateway;
          const hint = document.createElement('span');
          hint.className = 'combobox-load';
          hint.textContent = `${server.load.toFixed(1)}%`;
          row.appendChild(hint);
          row.addEventListener('click', () => this.select(server.gateway));
          cityEl.appendChild(row);
        }
      }
    }
  }

  private select(value: string): void {
    this.currentValue = value;
    this.renderTrigger();
    this.close();
    if (this.config) this.config.onSelect(value);
  }

  private onSearchKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      const first = this.listEl.querySelector<HTMLElement>('.combobox-server');
      if (first) first.click();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.listEl.querySelector<HTMLElement>('.combobox-server')?.focus();
    }
  }
}

export function buildGlobalOptions(global: GlobalProxy): ComboboxOption[] {
  return [
    { value: 'global:direct', label: 'Direct' },
    { value: 'global:random', label: 'Random' },
    ...(global.kind === 'socks5' ? [{ value: 'global:socks5', label: global.label, disabled: true }] : []),
  ];
}

export function buildCurrentSiteOptions(global: GlobalProxy): ComboboxOption[] {
  const currentLabel =
    global.kind === 'socks5' ? global.label : global.kind === 'random' ? 'Random' : 'Direct';
  const opts: ComboboxOption[] = [
    { value: 'site:inherit', label: 'Inherit from global', hint: `(current: ${currentLabel})` },
    { value: 'site:direct', label: 'Direct' },
    { value: 'site:random', label: 'Random' },
  ];
  // When global is a specific server, the "Global" choice in per-site
  // mirrors that. When global is direct, no per-site "Global" entry
  // (it'd be the same as Inherit).
  return opts;
}

export const SPECIAL_VALUES = {
  globalDirect: 'global:direct',
  globalRandom: 'global:random',
  globalSocks5: 'global:socks5',
  siteInherit: 'site:inherit',
  siteDirect: 'site:direct',
  siteRandom: 'site:random',
} as const;
