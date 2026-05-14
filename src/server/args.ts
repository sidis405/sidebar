export type ParsedArgs = {
  port: number | undefined;
  scope: string | undefined;
  browser: string;
  verbose: boolean;
  quiet: boolean;
  helpRequested: boolean;
};

export class ArgsError extends Error {}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    port: undefined,
    scope: undefined,
    browser: "default",
    verbose: false,
    quiet: false,
    helpRequested: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--port":
      case "-p": {
        const v = argv[++i];
        const n = Number.parseInt(v ?? "", 10);
        if (!Number.isFinite(n) || n < 0 || n > 65_535) {
          throw new ArgsError(`--port expects an integer 0-65535 (got ${v ?? "<missing>"})`);
        }
        out.port = n;
        break;
      }
      case "--scope": {
        const v = argv[++i];
        if (!v) throw new ArgsError("--scope expects a glob");
        out.scope = v;
        break;
      }
      case "--browser": {
        const v = argv[++i];
        if (!v) throw new ArgsError("--browser expects a value (default, none, chrome, ...)");
        out.browser = v;
        break;
      }
      case "--verbose":
        out.verbose = true;
        break;
      case "--quiet":
        out.quiet = true;
        break;
      case "--help":
      case "-h":
        out.helpRequested = true;
        break;
      default:
        if (a.startsWith("--")) {
          throw new ArgsError(`unknown flag: ${a}`);
        }
        // Positional args reserved for future subcommands (init,
        // scaffold-skill). Slice 01 does not consume them; reject anything
        // unexpected so silent typos don't get swallowed.
        throw new ArgsError(`unexpected argument: ${a}`);
    }
  }

  return out;
}

export function helpText(): string {
  return [
    "Usage: sidebar [options]",
    "",
    "Local-first markdown editor and MCP server for human-agent doc collaboration.",
    "",
    "Options:",
    "  --port <N>        Bind a specific HTTP port. --port 0 picks any free port.",
    "                    Without --port, sidebar tries 5180-5189 in order.",
    "  --scope <glob>    Override the default workspace glob (docs/**/*.md).",
    "  --browser <name>  default | none | <app-name>. `none` skips browser launch.",
    "  --verbose         Raise log level to DEBUG.",
    "  --quiet           Lower log level to WARN.",
    "  -h, --help        Show this help.",
    "",
  ].join("\n");
}
