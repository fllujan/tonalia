import { useTranslation } from "react-i18next";
import { LogoMark } from "../../components/brand/Logo";

// While the engine starts (a few seconds; longer the first time macOS checks the app):
// the welcome screen's halo and logo in the same place, so whichever screen follows —
// welcome or library — arrives without the other flashing first.
export function StartupScreen() {
  const { t } = useTranslation();
  return (
    <section
      data-tauri-drag-region
      role="status"
      aria-label={t("startup.loading")}
      aria-busy
      className="relative flex flex-1 flex-col items-center overflow-hidden bg-bg"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 left-1/2 h-[520px] w-[720px] -translate-x-1/2 rounded-pill bg-aurora opacity-25 blur-[130px]"
      />
      <div className="relative z-10 flex flex-col items-center px-6 pt-[88px]">
        <LogoMark size={120} spinning />
        <p className="mt-8 text-body text-text-3">{t("startup.loading")}</p>
      </div>
    </section>
  );
}
