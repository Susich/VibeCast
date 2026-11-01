import { useStore } from "../store";
import { THEMES } from "../themes";
import type { SortKey } from "../lib/types";
import {
  LinkIcon,
  OverlayIcon,
  PaletteIcon,
  RefreshIcon,
  SearchIcon,
  SettingsIcon,
  XIcon,
} from "./Icons";

const sortOptions: Array<{ value: SortKey; label: string }> = [
  { value: "title", label: "По названию" },
  { value: "artist", label: "По исполнителю" },
  { value: "album", label: "По альбому" },
  { value: "duration", label: "По длительности" },
  { value: "added", label: "Сначала новые" },
];

export function TopBar() {
  const search = useStore((state) => state.search);
  const sort = useStore((state) => state.sort);
  const theme = useStore((state) => state.theme);
  const loading = useStore((state) => state.loading);
  const server = useStore((state) => state.server);
  const setSearch = useStore((state) => state.setSearch);
  const setSort = useStore((state) => state.setSort);
  const setTheme = useStore((state) => state.setTheme);
  const toggleOverlay = useStore((state) => state.toggleOverlay);
  const openConnect = useStore((state) => state.openConnect);
  const openSettings = useStore((state) => state.openSettings);
  const resync = useStore((state) => state.resync);

  return (
    <header className="topbar">
      <div className="search-box">
        <SearchIcon size={17} />
        <input
          id="global-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Поиск по трекам, исполнителям, альбомам…"
          spellCheck={false}
          autoComplete="off"
        />
        {search ? (
          <button className="search-clear" onClick={() => setSearch("")} title="Очистить">
            <XIcon size={15} />
          </button>
        ) : (
          <kbd>/</kbd>
        )}
      </div>

      <div className="topbar-actions">
        <label className="theme-select" title="Тема оформления">
          <PaletteIcon size={16} />
          <select value={theme} onChange={(event) => void setTheme(event.target.value)}>
            {Object.entries(THEMES).map(([id, item]) => (
              <option key={id} value={id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label className="sort-select" title="Сортировка">
          <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <button
          className="icon-button"
          title="Компактный оверлей"
          onClick={() => void toggleOverlay(true)}
        >
          <OverlayIcon size={18} />
        </button>

        <button
          className="icon-button"
          title="Обновить каталог"
          onClick={() => (server ? void resync() : openConnect())}
          disabled={!server || loading}
        >
          <RefreshIcon size={18} className={loading ? "spin" : undefined} />
        </button>

        <button className="icon-button" title="Настройки" onClick={openSettings}>
          <SettingsIcon size={18} />
        </button>

        <button className="connect-button" onClick={openConnect} aria-label="Подключить телефон" title="Подключить телефон">
          <LinkIcon size={16} />
          <span>{server ? "Сменить телефон" : "Подключить"}</span>
        </button>
      </div>
    </header>
  );
}
