import { Lcd } from "@/design-system";

type StatusScreenProps = {
  /** Mono tag of the LCD readout ("404"). */
  lcdTag: string;
  lcdText: string;
  heading: string;
  description: string;
  /** Lets an error page move the focus to the heading (it has `tabIndex={-1}`). */
  headingRef?: React.Ref<HTMLHeadingElement>;
  /** The actions (keys and links). */
  children: React.ReactNode;
  /** Small print under the actions (the error code). */
  footnote?: React.ReactNode;
};

/**
 * Layout of the 404 and error pages (C8): an LCD readout that says what happened, the heading, a
 * blame-free line and the way out. Centered in whatever contains it (the shell's `<main>` or a
 * page of its own). No hooks, so Server and Client Components can both render it; no motion.
 */
export function StatusScreen({
  lcdTag,
  lcdText,
  heading,
  description,
  headingRef,
  children,
  footnote,
}: StatusScreenProps) {
  return (
    <div className="mx-auto flex w-full max-w-(--content-max) flex-1 flex-col justify-center px-4 py-8 md:px-6 lg:py-12">
      <div className="flex w-full max-w-100 flex-col gap-8">
        {/* Part of the page text, not a status message: the page itself is the news. */}
        <Lcd tag={lcdTag} live={false}>
          {lcdText}
        </Lcd>
        <header className="flex flex-col gap-3">
          <h1 ref={headingRef} tabIndex={-1} className="bo-text-display outline-none">
            {heading}
          </h1>
          <p className="bo-text-body text-text-secondary">{description}</p>
        </header>
        <div className="flex flex-wrap gap-3">{children}</div>
        {footnote}
      </div>
    </div>
  );
}
