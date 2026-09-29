import type { Metadata } from "next";
import { ThemeProvider } from "@/design-system";
import { fontVariables } from "@/design-system/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "brahua-os",
  description: "Mi segundo cerebro: hábitos, tareas, proyectos y más.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // next-themes sets data-theme before hydration, so the attribute differs from the server HTML.
    <html lang="es" className={`${fontVariables} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
