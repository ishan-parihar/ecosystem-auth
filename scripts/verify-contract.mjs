#!/usr/bin/env node
/**
 * Enforce this package's contract.
 *
 * Same job as `@ishan/ecosystem-core`'s script, with one difference: importing
 * `better-auth` is allowed here, because that dependency is the entire reason
 * this package exists. What is still banned is the surface-level coupling -
 * reading `$env`, reaching into SvelteKit's virtual modules, or constructing a
 * service at import time. Those are what make a package work in one application
 * and break in the next.
 *
 * The SvelteKit ban is not stylistic. If this package imported
 * `better-auth/svelte-kit`, it could not be used from the CMS, a script, or any
 * non-SvelteKit Worker - and the surface hook is five lines.
 *
 * Comments are stripped before scanning, so prose may name the banned modules.
 *
 * Usage: node scripts/verify-contract.mjs
 * Exit code 1 on any violation.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

const BANNED = [
	{
		name: 'SvelteKit virtual module ($env/$lib/$app)',
		re: /(?:from|import)\s*\(?\s*['"`]\$(?:env|lib|app)\b/,
		hint: 'Pass the value in as an argument. Configuration belongs to the surface.',
	},
	{
		name: 'SvelteKit or Better Auth SvelteKit adapter',
		re: /(?:from|import)\s*\(?\s*['"`](?:@sveltejs\/kit|better-auth\/svelte-kit|better-auth\/svelte)['"`]/,
		hint: 'Keep this package framework-agnostic; the surface wires the hook.',
	},
	{
		name: 'import.meta.env',
		re: /import\.meta\.env/,
		hint: 'Vite-specific. Accept a config object instead.',
	},
	{
		name: 'node: builtin',
		re: /(?:from|import)\s*\(?\s*['"`]node:|\brequire\s*\(\s*['"`]node:/,
		hint: 'The Workers runtime exposes Web APIs. Use fetch, crypto.subtle, TextEncoder.',
	},
	{
		name: 'bare Node builtin import',
		re: /(?:from|require\s*\()\s*['"`](?:fs|path|os|crypto|http|https|stream|buffer|events|util)(?:\/|['"`])/,
		hint: 'Use the Web API equivalent, or move the code out of the package.',
	},
];

const MODULE_SINGLETON = {
	name: 'module-level service construction',
	re: /^(?:export\s+)?(?:const|let)\s+\w+\s*=\s*(?:await\s+)?(?:createAuthAdapter|betterAuth)\s*\(/m,
	hint: 'Call it per request: Better Auth reads a per-request Cloudflare binding.',
};

function stripComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...walk(full));
		else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
	}
	return out;
}

let failures = 0;
const files = walk(SRC);

for (const file of files) {
	const raw = readFileSync(file, 'utf8');
	const code = stripComments(raw);
	const where = relative(ROOT, file);

	for (const rule of BANNED) {
		const match = code.match(rule.re);
		if (match) {
			failures++;
			console.error(`✘ ${where}: ${rule.name} — found ${JSON.stringify(match[0])}`);
			console.error(`    ${rule.hint}`);
		}
	}

	const singleton = code.match(MODULE_SINGLETON.re);
	if (singleton) {
		failures++;
		console.error(`✘ ${where}: ${MODULE_SINGLETON.name} — found ${JSON.stringify(singleton[0])}`);
		console.error(`    ${MODULE_SINGLETON.hint}`);
	}
}

if (failures > 0) {
	console.error(`\n${failures} contract violation(s) across ${files.length} file(s).`);
	process.exit(1);
}

console.log(`✔ contract clean (${files.length} source file(s))`);
