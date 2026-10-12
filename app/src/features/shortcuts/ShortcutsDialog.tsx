// "Keyboard shortcuts" dialog, opened with "?" or from the sidebar.
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/Modal";
import { SHORTCUT_GROUPS, useShortcutsDialog } from "./shortcuts";

export function ShortcutsDialog() {
  const { t } = useTranslation();
  const open = useShortcutsDialog((s) => s.open);
  const setOpen = useShortcutsDialog((s) => s.setOpen);
  if (!open) return null;
  const label = (key: string) => (key.startsWith("@") ? t(`shortcuts.keys.${key.slice(1)}`) : key);
  return (
    <Modal label={t("shortcuts.title")} onClose={() => setOpen(false)} width={640}>
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="font-display text-title">{t("shortcuts.title")}</h2>
        <button
          type="button"
          data-autofocus
          onClick={() => setOpen(false)}
          className="h-8 rounded-sm border border-border bg-surface-3 px-3 text-text"
        >
          {t("toast.dismiss")}
        </button>
      </header>
      <div className="grid min-h-0 grid-cols-2 gap-x-8 gap-y-5 overflow-auto px-5 py-4">
        {SHORTCUT_GROUPS.map(({ group, items }) => (
          <section key={group} aria-labelledby={`shortcuts-${group}`}>
            <h3 id={`shortcuts-${group}`} className="mb-2 text-label uppercase text-text-3">
              {t(`shortcuts.groups.${group}`)}
            </h3>
            <dl className="flex flex-col gap-1.5">
              {items.map(({ keys, action }) => (
                <div key={action} className="flex items-center justify-between gap-3">
                  <dt className="text-body text-text-2">{t(`shortcuts.actions.${action}`)}</dt>
                  <dd className="flex shrink-0 gap-1">
                    {keys.map((key) => (
                      <kbd
                        key={key}
                        className="min-w-[22px] rounded-[4px] border border-border-strong bg-surface-3 px-1.5 text-center font-mono text-[11px] leading-[20px] text-text"
                      >
                        {label(key)}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
