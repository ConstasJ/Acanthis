export const DEFAULT_EPUB_CSS = `html,
body {
	margin: 0;
	padding: 0;
	font-family: "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "SimSun", Georgia, serif;
	font-size: 1em;
	line-height: 1.85;
	color: #1f2328;
	text-align: justify;
	word-break: break-word;
}

body {
	padding: 0.5em 0.8em;
}

p {
	margin: 0.45em 0;
	text-indent: 2em;
}

h1.chapter-title {
	margin: 1.4em 0 1.6em;
	font-size: 1.45em;
	font-weight: 700;
	line-height: 1.4;
	text-align: center;
	text-indent: 0;
	break-after: avoid;
	page-break-after: avoid;
}

.volume-title-page {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	min-height: 88vh;
	text-align: center;
	padding: 2em 1em;
	break-inside: avoid;
	page-break-inside: avoid;
}

h1.volume-title {
	margin: 1em 0;
	font-size: 1.75em;
	font-weight: 700;
	line-height: 1.4;
	text-align: center;
	text-indent: 0;
}

.cover-page {
	margin: 0;
	padding: 0;
	text-align: center;
	break-inside: avoid;
	page-break-inside: avoid;
}

img {
	display: block;
	margin: 1em auto;
	max-width: 100%;
	max-height: 100vh;
	width: auto;
	height: auto;
	object-fit: contain;
	break-inside: avoid;
	page-break-inside: avoid;
}

.cover-page img {
	margin: 0 auto;
}

ruby {
	ruby-align: center;
	ruby-position: over;
}

rt {
	font-size: 0.55em;
	line-height: 1.1;
	text-align: center;
}

hr {
	border: 0;
	border-top: 1px solid #d0d7de;
	margin: 1.5em auto;
	width: 40%;
}

.image-placeholder {
	margin: 1em auto;
	padding: 0.75em 1em;
	border: 1px dashed #9ca3af;
	color: #6b7280;
	background-color: #f9fafb;
	font-size: 0.9em;
	text-align: center;
	text-indent: 0;
	break-inside: avoid;
	page-break-inside: avoid;
}
`;
