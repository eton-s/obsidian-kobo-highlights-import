import * as chai from "chai";
import { applyTemplateTransformations, defaultTemplate } from "./template";
import { Bookmark } from "../database/interfaces";

describe("template", async function () {
	const testDate = new Date("2023-01-01T12:00:00Z");
	const chapters = new Map<string, Bookmark[]>([
		[
			"Chapter 1",
			[
				{
					bookmarkId: "1",
					text: "test",
					contentId: "content1",
					dateCreated: testDate,
				},
			],
		],
		[
			"Chapter 2",
			[
				{
					bookmarkId: "1",
					text: "test2",
					contentId: "content2",
					dateCreated: testDate,
					note: "note2",
				},
			],
		],
	]);

	function normalize(s: string) {
		return s
			.replace(/\r\n/g, "\n")
			.split("\n")
			.map((line) => line.trimEnd())
			.join("\n")
			.trim();
	}

	it("applyTemplateTransformations default", async function () {
		const content = applyTemplateTransformations(
			defaultTemplate,
			chapters,
			{
				title: "test title",
				author: "test",
			},
		);
		chai.expect(normalize(content)).equal(
			normalize(
				`---
title: "test title"
author: test
publisher:
dateLastRead:
readStatus: Unknown
percentRead:
isbn:
series:
seriesNumber:
timeSpentReading:
---

# test title

## Description



## Highlights

## Chapter 1

test

*Created: 2023-01-01T12:00:00.000Z*

## Chapter 2

test2

**Note:** note2

*Created: 2023-01-01T12:00:00.000Z*`,
			),
		);
	});

	const templates = new Map<string, [string, string]>([
		[
			"default",
			[
				defaultTemplate,
				`---
title: "test title"
author: test
publisher:
dateLastRead:
readStatus: Unknown
percentRead:
isbn:
series:
seriesNumber:
timeSpentReading:
---

# test title

## Description



## Highlights

## Chapter 1

test

*Created: 2023-01-01T12:00:00.000Z*

## Chapter 2

test2

**Note:** note2

*Created: 2023-01-01T12:00:00.000Z*`,
			],
		],
		[
			"with front matter",
			[
				`
---
tag: [tags]
title: <%= it.bookDetails.title %>
---
# <%= it.bookDetails.title %>

<% it.chapters.forEach(([chapterName, highlights]) => { %>
<%- highlights.forEach(h => { -%>
<%= h.text %>
<% }) %>
<% }) %>`,
				`---
tag: [tags]
title: test title
---
# test title

test

test2
`,
			],
		],
		[
			"with date formatting",
			[
				`
---
title: "<%= it.bookDetails.title %>"
---

# <%= it.bookDetails.title %>

<% it.chapters.forEach(([chapterName, highlights]) => { -%>
## <%= chapterName %>

<% highlights.forEach(h => { -%>
<%= h.text %>

*Created: <%= h.dateCreated.getFullYear() %>-<%= String(h.dateCreated.getMonth() + 1).padStart(2, '0') %>-<%= String(h.dateCreated.getDate()).padStart(2, '0') %>*

<% }) -%>
<% }) %>`,
				`---
title: "test title"
---

# test title

## Chapter 1

test

*Created: 2023-01-01*

## Chapter 2

test2

*Created: 2023-01-01*
`,
			],
		],
	]);

	for (const [title, [template, expected]] of templates) {
		it(`applyTemplateTransformations ${title}`, async function () {
			const content = applyTemplateTransformations(
				template,
				chapters,
				{
					title: "test title",
					author: "test",
				},
			);
			chai.expect(normalize(content)).equal(normalize(expected));
		});
	}

	it("applyTemplateTransformations with dedup chapters", async function () {
		const dedupChapters = new Map<string, Bookmark[]>([
			[
				"Chapter 1",
				[
					{
						bookmarkId: "1",
						text: "highlight in part one",
						contentId: "c1",
						dateCreated: testDate,
					},
				],
			],
			[
				"Chapter 1 (2)",
				[
					{
						bookmarkId: "2",
						text: "highlight in part two",
						contentId: "c2",
						dateCreated: testDate,
					},
				],
			],
		]);

		const content = applyTemplateTransformations(
			defaultTemplate,
			dedupChapters,
			{ title: "1984", author: "George Orwell" },
		);

		const normalized = normalize(content);
		chai.expect(normalized).to.include("## Chapter 1");
		chai.expect(normalized).to.include("## Chapter 1 (2)");
		chai.expect(normalized).to.include("highlight in part one");
		chai.expect(normalized).to.include("highlight in part two");
	});
});
