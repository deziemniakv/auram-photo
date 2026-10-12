import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { COMMANDS, MENUS, formatBinding, type AppCommand } from '../editor/commands';
import { useEditor } from '../editor/store';
import { useT } from '../i18n';
import styles from './MenuBar.module.css';

/** Application menu bar (File, Edit, …) drawn inside the custom title bar. */
export function MenuBar() {
  const t = useT();
  const state = useEditor();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const triggers = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (!openMenu) return;
    const close = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [openMenu]);

  // Focus the first enabled item when a menu opens from the keyboard.
  const focusItem = (menuId: string, index: number) => {
    requestAnimationFrame(() => {
      const items = barRef.current?.querySelectorAll<HTMLButtonElement>(
        `[data-menu="${menuId}"] button:not(:disabled)`,
      );
      if (!items || items.length === 0) return;
      items[(index + items.length) % items.length]!.focus();
    });
  };

  const moveMenu = (from: string, direction: 1 | -1, focusFirst: boolean) => {
    const index = MENUS.findIndex((menu) => menu.id === from);
    const next = MENUS[(index + direction + MENUS.length) % MENUS.length]!;
    setOpenMenu(next.id);
    if (focusFirst) focusItem(next.id, 0);
    else triggers.current[next.id]?.focus();
  };

  const onMenuKey = (event: KeyboardEvent, menuId: string) => {
    const items = [
      ...(barRef.current?.querySelectorAll<HTMLButtonElement>(
        `[data-menu="${menuId}"] button:not(:disabled)`,
      ) ?? []),
    ];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown') focusItem(menuId, current + 1);
    else if (event.key === 'ArrowUp') focusItem(menuId, current - 1);
    else if (event.key === 'ArrowRight') moveMenu(menuId, 1, true);
    else if (event.key === 'ArrowLeft') moveMenu(menuId, -1, true);
    else if (event.key === 'Escape') {
      setOpenMenu(null);
      triggers.current[menuId]?.focus();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div ref={barRef} className={styles.menubar} role="menubar" aria-label={t.menu.label}>
      {MENUS.map((menu) => (
        <div key={menu.id} className={styles.root}>
          <button
            ref={(element) => {
              triggers.current[menu.id] = element;
            }}
            type="button"
            role="menuitem"
            className={styles.trigger}
            aria-haspopup="menu"
            aria-expanded={openMenu === menu.id}
            onClick={() => setOpenMenu(openMenu === menu.id ? null : menu.id)}
            onPointerEnter={() => openMenu && openMenu !== menu.id && setOpenMenu(menu.id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setOpenMenu(menu.id);
                focusItem(menu.id, 0);
              } else if (event.key === 'ArrowRight') moveMenu(menu.id, 1, false);
              else if (event.key === 'ArrowLeft') moveMenu(menu.id, -1, false);
            }}
          >
            {menu.label(t)}
          </button>
          {openMenu === menu.id && (
            <ul
              className={styles.menu}
              role="menu"
              data-menu={menu.id}
              aria-label={menu.label(t)}
              onKeyDown={(event) => onMenuKey(event, menu.id)}
            >
              {menu.items.map((entry, index) => {
                if (entry === '-')
                  return <li key={`sep-${index}`} role="separator" className={styles.separator} />;
                const command = COMMANDS[entry] as AppCommand;
                const enabled = command.enabled ? command.enabled(state) : true;
                const binding = command.keys?.[0];
                return (
                  <li key={entry} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.item}
                      disabled={!enabled}
                      onClick={() => {
                        setOpenMenu(null);
                        command.run();
                      }}
                    >
                      <span>{command.label(t, state)}</span>
                      {binding && <span className={styles.shortcut}>{formatBinding(binding)}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
