import { useStore } from "../store";
import type { SortKey } from "../lib/types";
import { CustomDropdown } from "./CustomDropdown";
import {
  ArrowUpDownIcon,
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
  const loading = useStore((state) => state.loading);
  const server = useStore((state) => state.server);
  const setSearch = useStore((state) => state.setSearch);
  const setSort = useStore((state) => state.setSort);
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
        <CustomDropdown
          value={sort}
          options={sortOptions}
          onChange={(newSort) => setSort(newSort)}
          title="Сортировка каталога"
          icon={<ArrowUpDownIcon size={14} />}
        />

        <button
          className="icon-button topbar-btn"
          title="Обновить каталог"
          onClick={() => (server ? void resync() : openConnect())}
          disabled={!server || loading}
        >
          <RefreshIcon size={18} className={loading ? "spin" : undefined} />
        </button>

        <button className="icon-button topbar-btn settings-btn" title="Настройки" onClick={openSettings}>
          <SettingsIcon size={18} />
        </button>
      </div>
    </header>
  );
}
