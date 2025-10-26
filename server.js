#!/usr/bin/env node
"use strict";

const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { URL } = require("url");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 10080);
const EXPLORER_ROOT = process.env.EXPLORER_ROOT
	? path.resolve(process.env.EXPLORER_ROOT)
	: path.join(__dirname, "explorer");
const TEMPLATE_PATH = path.join(__dirname, "template.html");

let TEMPLATE_HTML = null;
try {
	TEMPLATE_HTML = fs.readFileSync(TEMPLATE_PATH, "utf8");
} catch (err) {
	console.error(
		`Failed to load explorer template at ${TEMPLATE_PATH}:`,
		err.message
	);
	TEMPLATE_HTML =
		"<!DOCTYPE html><html><body><nav>{{breadcrumbs}}</nav><table>{{files}}</table><footer>{{year}}</footer></body></html>";
}

const MIME_TYPES = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".mjs": "application/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".avif": "image/avif",
	".txt": "text/plain; charset=utf-8",
	".xml": "application/xml; charset=utf-8",
	".pdf": "application/pdf",
	".wasm": "application/wasm",
	".mp4": "video/mp4",
	".mp3": "audio/mpeg",
	".ogg": "audio/ogg",
	".wav": "audio/wav",
};

function getMimeType(filePath) {
	const ext = path.extname(filePath).toLowerCase();
	return MIME_TYPES[ext] || "application/octet-stream";
}

function ensureTrailingSlash(value) {
	return value.endsWith("/") ? value : `${value}/`;
}

async function resolveSafePath(relativeRequestPath, { mustExist = true } = {}) {
	const normalizedRequest = normalizeRelativePath(relativeRequestPath);
	const targetPath = path.join(EXPLORER_ROOT, normalizedRequest);
	const normalizedTarget = path.normalize(targetPath);

	if (!normalizedTarget.startsWith(EXPLORER_ROOT)) {
		throw Object.assign(new Error("Path escapes explorer root"), {
			statusCode: 400,
		});
	}

	if (!mustExist) {
		return { absolutePath: normalizedTarget, relativePath: normalizedRequest };
	}

	let stats;
	try {
		stats = await fsp.stat(normalizedTarget);
	} catch (err) {
		if (err.code === "ENOENT") {
			throw Object.assign(new Error("Requested path not found"), {
				statusCode: 404,
			});
		}
		throw err;
	}

	return {
		absolutePath: normalizedTarget,
		relativePath: normalizedRequest,
		stats,
	};
}

function normalizeRelativePath(requested = "") {
	if (!requested) {
		return "";
	}

	const decoded = decodeURIComponent(requested);
	const sanitizedSegments = decoded
		.split(/[\\/]+/)
		.filter(Boolean)
		.map((segment) => (segment === "." ? "" : segment))
		.filter((segment) => segment && segment !== "..");

	return sanitizedSegments.join(path.sep);
}

function webPathToRelative(webPath) {
	if (!webPath || webPath === "/") {
		return "";
	}

	const trimmed = webPath.replace(/^\/+|\/+$/g, "");
	return normalizeRelativePath(trimmed);
}

function escapeHtml(value = "") {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function formatBytes(bytes) {
	if (!Number.isFinite(bytes) || bytes < 0) {
		return "";
	}
	if (bytes === 0) {
		return "0 B";
	}
	const units = ["B", "KB", "MB", "GB", "TB"];
	const exponent = Math.min(
		Math.floor(Math.log(bytes) / Math.log(1024)),
		units.length - 1
	);
	const value = bytes / Math.pow(1024, exponent);
	return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${
		units[exponent]
	}`;
}

async function countItems(directoryPath) {
	try {
		const entries = await fsp.readdir(directoryPath);
		return entries.length;
	} catch (err) {
		return null;
	}
}

function buildBreadcrumbs(relativePath) {
	const segments = relativePath.split(path.sep).filter(Boolean);
	const crumbs = ['<a href="./">explorer</a>'];
	const encodedSegments = [];

	for (const segment of segments) {
		encodedSegments.push(encodeURIComponent(segment));
		const href = `./${encodedSegments.join("/")}/`;
		crumbs.push(`<a href="${href}">${escapeHtml(segment)}</a>`);
	}

	return crumbs.join(" / ");
}

function renderTemplate(context) {
	return TEMPLATE_HTML.replace(/{{\s*(\w+)\s*}}/g, (match, token) => {
		if (Object.prototype.hasOwnProperty.call(context, token)) {
			return context[token];
		}
		return "";
	});
}

async function renderDirectoryListing(relativePath) {
	const { absolutePath, stats } = await resolveSafePath(relativePath);

	if (stats && !stats.isDirectory()) {
		throw Object.assign(new Error("Requested path is not a directory"), {
			statusCode: 404,
		});
	}

	const entries = await fsp.readdir(absolutePath, { withFileTypes: true });
	const items = await Promise.all(
		entries.map(async (entry) => {
			const entryStats = await fsp.stat(path.join(absolutePath, entry.name));
			const encodedName = encodeURIComponent(entry.name);
			const href = entry.isDirectory() ? `${encodedName}/` : encodedName;
			return {
				name: entry.name,
				isDirectory: entry.isDirectory(),
				href,
				downloadHref: entry.isDirectory() ? null : `${href}?download=1`,
				size: entryStats.isDirectory() ? "" : formatBytes(entryStats.size),
				itemCount: entryStats.isDirectory()
					? await countItems(path.join(absolutePath, entry.name))
					: null,
				lastModified: entryStats.mtime,
			};
		})
	);

	items.sort((a, b) => {
		if (a.isDirectory !== b.isDirectory) {
			return a.isDirectory ? -1 : 1;
		}
		return a.name.localeCompare(b.name);
	});

	if (relativePath) {
		items.unshift({
			name: "..",
			isDirectory: true,
			href: "../",
			downloadHref: null,
			size: "",
			itemCount: null,
			lastModified: null,
			isParent: true,
		});
	}

	const breadcrumbs = buildBreadcrumbs(relativePath);
	const rows = items.length
		? items.map(renderRow).join("\n")
		: '<tr><td colspan="4" class="empty">This directory is empty.</td></tr>';

	return renderTemplate({
		breadcrumbs,
		files: rows,
		year: String(new Date().getFullYear()),
	});
}

function renderRow(item) {
	const icon = item.isDirectory ? "📁" : "📄";
	const displayName = escapeHtml(item.name);
	const href = escapeHtml(item.href);
	const formattedDate = item.lastModified
		? new Intl.DateTimeFormat("en", {
				year: "numeric",
				month: "short",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
		  }).format(item.lastModified)
		: "";

	const size = item.isDirectory
		? item.itemCount === null
			? ""
			: `${item.itemCount} item${item.itemCount === 1 ? "" : "s"}`
		: item.size;

	const downloadLink = item.isDirectory
		? ""
		: `<a class="download" href="${escapeHtml(
				item.downloadHref
		  )}">Download</a>`;

	return `<tr>
        <td class="name"><a href="${href}"><span class="icon">${icon}</span>${displayName}</a></td>
        <td>${escapeHtml(size || "")}</td>
        <td>${escapeHtml(formattedDate)}</td>
        <td>${downloadLink}</td>
    </tr>`;
}

async function serveDirectory(relativePath, res) {
	try {
		const html = await renderDirectoryListing(relativePath);
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		res.end(html);
	} catch (err) {
		respondWithError(res, err);
	}
}

async function serveFile(
	relativePath,
	requestUrl,
	res,
	{ forceDownload = false } = {}
) {
	let resolved;
	try {
		resolved = await resolveSafePath(relativePath);
	} catch (err) {
		respondWithError(res, err);
		return;
	}

	if (resolved.stats.isDirectory()) {
		const location =
			ensureTrailingSlash(requestUrl.pathname) + requestUrl.search;
		res.writeHead(301, { Location: location });
		res.end();
		return;
	}

	const headers = {
		"Content-Type": getMimeType(resolved.absolutePath),
		"Content-Length": resolved.stats.size,
		"Last-Modified": resolved.stats.mtime.toUTCString(),
	};

	const shouldDownload =
		forceDownload || requestUrl.searchParams.has("download");
	if (shouldDownload) {
		headers[
			"Content-Disposition"
		] = `attachment; filename="${encodeURIComponent(
			path.basename(resolved.absolutePath)
		)}"`;
	}

	res.writeHead(200, headers);
	fs.createReadStream(resolved.absolutePath).pipe(res);
}

async function handleLegacyQuery(requestUrl, res) {
	const legacyPath = normalizeRelativePath(
		requestUrl.searchParams.get("path") || ""
	);
	await serveDirectory(legacyPath, res);
}

async function handleLegacyDownload(requestUrl, res) {
	const relativePath = requestUrl.searchParams.get("path");

	if (!relativePath) {
		respondWithError(
			res,
			Object.assign(new Error("Missing path parameter"), { statusCode: 400 })
		);
		return;
	}

	const legacyUrl = new URL(requestUrl.href);
	legacyUrl.searchParams.set("download", "1");
	await serveFile(normalizeRelativePath(relativePath), legacyUrl, res, {
		forceDownload: true,
	});
}

function respondWithError(res, error) {
	const status =
		error.statusCode && Number.isInteger(error.statusCode)
			? error.statusCode
			: 500;
	const message =
		status === 404
			? "Not Found"
			: status === 400
			? "Bad Request"
			: "Internal Server Error";

	res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
	res.end(
		`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${status} ${message}</title></head><body><h1>${status} ${message}</h1><p>${escapeHtml(
			error.message || message
		)}</p></body></html>`
	);
}

const server = http.createServer(async (req, res) => {
	const requestUrl = new URL(req.url, `http://${req.headers.host}`);

	if (req.method !== "GET") {
		res.writeHead(405, {
			"Content-Type": "text/plain; charset=utf-8",
			Allow: "GET",
		});
		res.end("Method Not Allowed");
		return;
	}

	if (requestUrl.pathname === "/download") {
		await handleLegacyDownload(requestUrl, res);
		return;
	}

	if (requestUrl.pathname === "/" && requestUrl.searchParams.has("path")) {
		await handleLegacyQuery(requestUrl, res);
		return;
	}

	const pathname = decodeURIComponent(requestUrl.pathname);

	if (pathname === "/" || pathname.endsWith("/")) {
		const relativePath = webPathToRelative(pathname);
		await serveDirectory(relativePath, res);
		return;
	}

	const relativeFilePath = webPathToRelative(pathname);
	await serveFile(relativeFilePath, requestUrl, res);
});

server.listen(PORT, HOST, () => {
	console.log(
		`Explorer server running at http://${HOST}:${PORT}/ with root ${EXPLORER_ROOT}`
	);
});
