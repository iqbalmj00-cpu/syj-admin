import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Exercise real route/store code with an explicit import allowlist. No Prisma
// client, auth module, environment file, network or application startup executes.
export function isolatedModule(path: string, imports: Record<string, unknown>, env: Record<string, string> = {}) {
    const filename = resolve(path);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        fileName: filename,
    }).outputText;
    const module = { exports: {} as Record<string, any> };
    const builtinRequire = createRequire(import.meta.url);
    runInNewContext(code, {
        module, exports: module.exports,
        require: (name: string) => {
            if (Object.hasOwn(imports, name)) return imports[name];
            if (name === "crypto" || name === "node:crypto") return builtinRequire(name);
            throw new Error(`Unmocked import blocked: ${name}`);
        },
        process: { env: { ...env } },
        console: { log() {}, warn() {}, error() {} },
        Date, URL, URLSearchParams, Set, Map, Buffer,
        fetch: () => { throw new Error("Network disabled in isolated tests"); },
    }, { filename });
    return module.exports;
}

export const nextResponseMock = { NextResponse: { json: (data: unknown, init?: ResponseInit) => Response.json(data, init) } };
