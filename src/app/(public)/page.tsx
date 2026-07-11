import { t } from "@/i18n/de";

export default function HomePage() {
  const dict = t();
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-4xl font-bold text-rose-primary">
        {dict.home.welcome}
      </h1>
      <p className="text-lg text-ink-soft">{dict.home.intro}</p>
    </main>
  );
}
