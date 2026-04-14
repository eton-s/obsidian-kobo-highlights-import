import { Eta } from "eta";
import { BookDetails, BookSection, ReadStatus } from "../database/interfaces";

const eta = new Eta({ autoEscape: false, autoTrim: false });

export const defaultTemplate = `
---
title: "<%= it.bookDetails.title %>"
author: <%= it.bookDetails.author %>
publisher: <%= it.bookDetails.publisher ?? '' %>
dateLastRead: <%= it.bookDetails.dateLastRead?.toISOString() ?? '' %>
readStatus: <%= it.bookDetails.readStatus ? it.ReadStatus[it.bookDetails.readStatus] : it.ReadStatus[it.ReadStatus.Unknown] %>
percentRead: <%= it.bookDetails.percentRead ?? '' %>
isbn: <%= it.bookDetails.isbn ?? '' %>
series: <%= it.bookDetails.series ?? '' %>
seriesNumber: <%= it.bookDetails.seriesNumber ?? '' %>
timeSpentReading: <%= it.bookDetails.timeSpentReading ?? '' %>
---

# <%= it.bookDetails.title %>

## Description

<%= it.bookDetails.description ?? '' %>

## Highlights

<% it.sections.forEach(function({ title, chapters }) { -%>
<% if (title) { -%>
## <%= title %>

<% } -%>
<% chapters.forEach(function([chapterName, highlights]) { -%>
<%= title ? '###' : '##' %> <%= chapterName.trim() %>

<% highlights.forEach(function(highlight) { -%>
<%= highlight.text %>

<% if (highlight.note) { -%>
**Note:** <%= highlight.note %>

<% } -%>
<% if (highlight.dateCreated) { -%>
*<%= highlight.dateCreated.toISOString() %>*

<% } -%>
<% }) -%>
<% }) -%>
<% }) %>
`;

export const defaultAppendTemplate = `
## Highlights

<% it.sections.forEach(function({ title, chapters }) { -%>
<% if (title) { -%>
### <%= title %>

<% } -%>
<% chapters.forEach(function([chapterName, highlights]) { -%>
<%= title ? '####' : '###' %> <%= chapterName.trim() %>

<% highlights.forEach(function(highlight) { -%>
<%= highlight.text %>

<% if (highlight.note) { -%>
**Note:** <%= highlight.note %>

<% } -%>
<% if (highlight.dateCreated) { -%>
*<%= highlight.dateCreated.toISOString() %>*

<% } -%>
<% }) -%>
<% }) -%>
<% }) %>
`;

export function applyTemplateTransformations(
	rawTemplate: string,
	sections: BookSection[],
	bookDetails: BookDetails,
): string {
	// Flat chapters array kept for backward compatibility with custom templates
	// that use `it.chapters` instead of `it.sections`.
	const chaptersArr = sections.flatMap((s) => s.chapters);

	const rendered = eta.renderString(rawTemplate, {
		bookDetails,
		chapters: chaptersArr,
		sections,
		ReadStatus,
	});

	if (rendered === null) {
		console.error(
			"Template rendering failed: eta.renderString returned null.",
		);

		return "Error: Template rendering failed. Check console for details.";
	}

	return rendered.trim();
}
