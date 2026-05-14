export type Subcommand = "serve" | "stdio" | "init";

export type ParsedArgs = {
  subcommand: Subcommand;
  /** Set when subcommand is `init`. */
  initAgent: string | undefined;
  /** Set when subcommand is `init` and the user passed `--yes`. */
  yes: boolean;
  port: number | undefined;
  scope: string | undefined;
  /** Undefined when --browser was not passed; resolves from local.json or
   * the "default" fallback at the call site. */
  browser: string | undefined;
  verbose: boolean;
  quiet: boolean;
  helpRequested: boolean;
};

export class ArgsError extends Error {}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    subcommand: "serve",
    initAgent: undefined,
    yes: false,
    port: undefined,
    scope: undefined,
    browser: undefined,
    verbose: false,
    quiet: false,
    helpRequested: false,
  };

  // Subcommand detection: first non-flag positional argument selects the
  // subcommand. `--stdio` is a flag, not a positional, so we handle it
  // alongside other flags. Slice 01 only had `serve`; slice 02 adds
  // `init` (and the `--stdio` invite hook).
  let i = 0;
  const first = argv[0];
  if (first === "init") {
    out.subcommand = "init";
    i = 1;
    // `init <agent>` is also accepted: read the next positional as the
    // agent name.
    if (argv[i] !== undefined && !argv[i].startsWith("--")) {
      out.initAgent = argv[i];
      i += 1;
    }
  }

  for (; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--port":
      case "-p": {
        const v = argv[++i];
        // parseInt silently coerces "123abc" -> 123 and "1.5" -> 1, both of
        // which can land the user on a port they did not ask for. Match
        // strict decimal-digit form first.
        if (!v || !/^\d+$/.test(v)) {
          throw new ArgsError(`--port expects a non-negative integer (got ${v ?? "<missing>"})`);
        }
        const n = Number.parseInt(v, 10);
        if (n > 65_535) {
          throw new ArgsError(`--port out of range 0-65535 (got ${n})`);
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
      case "--stdio":
        if (out.subcommand !== "serve") {
          throw new ArgsError("--stdio cannot be combined with a subcommand");
        }
        out.subcommand = "stdio";
        break;
      case "--yes":
      case "-y":
        out.yes = true;
        break;
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
        throw new ArgsError(`unexpected argument: ${a}`);
    }
  }

  return out;
}

export function helpText(): string {
  return [
    "Usage: sidebar [subcommand] [options]",
    "",
    "Local-first markdown editor and MCP server for human-agent doc collaboration.",
    "",
    "Subcommands:",
    "  (default)         Run sidebar standalone (HTTP MCP + editor).",
    "  init [agent]      Write a project-local .mcp.json that spawns sidebar via",
    "                    stdio. Defaults to claude-code when no agent is named.",
    "                    Pass --yes to skip the interactive prompt.",
    "  --stdio           Internal: spawned by an MCP client. Becomes primary or",
    "                    proxy depending on .sidebar/connection.json.",
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
