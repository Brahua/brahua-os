// Keyboard prompts for the owner-only scripts (`auth:owner`, `db:demo`): typed confirmations and
// hidden passwords. Never reads from arguments or environment variables.

export const CANCELLED = "Cancelado.";

/**
 * Reads a line from the terminal in raw mode. `hidden` never echoes what is typed.
 * Ctrl-C and Ctrl-D (end of input) cancel. Requires an interactive terminal.
 */
export function prompt(question: string, { hidden }: { hidden: boolean }): Promise<string> {
  const { stdin, stdout } = process;
  return new Promise((resolve, reject) => {
    let value = "";
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const finish = (error?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdin.removeListener("end", onEnd);
      stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };

    function onData(chunk: string) {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u0003" || char === "\u0004") return finish(new Error(CANCELLED));
        if (char === "\u007f" || char === "\b") {
          if (value && !hidden) stdout.write("\b \b");
          value = value.slice(0, -1);
        } else if (char >= " ") {
          value += char;
          if (!hidden) stdout.write(char);
        }
      }
    }
    // End of input (e.g. a closed terminal) also cancels instead of hanging.
    function onEnd() {
      finish(new Error(CANCELLED));
    }
    stdin.on("data", onData);
    stdin.on("end", onEnd);
  });
}
