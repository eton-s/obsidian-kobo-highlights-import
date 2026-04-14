import { BookDetails, BookSection, Bookmark, Content, Highlight } from "./interfaces";
import { Repository } from "./repository";

type bookTitle = string;
export type chapter = string;

export class HighlightService {
	repo: Repository;
	unknownBookTitle = "Unknown Title";
	unknownAuthor = "Unknown Author";

	constructor(repo: Repository) {
		this.repo = repo;
	}

	async getBookDetailsByIsbn(isbn: string): Promise<BookDetails | null> {
		return this.repo.getBookDetailsByIsbn(isbn);
	}

	async getBookDetailsFromBookTitle(title: string): Promise<BookDetails> {
		const details = await this.repo.getBookDetailsByBookTitle(title);

		if (details == null) {
			return {
				title: this.unknownBookTitle,
				author: this.unknownAuthor,
			};
		}

		return details;
	}

	convertToMap(arr: Highlight[]): Map<bookTitle, Map<chapter, Bookmark[]>> {
		const m = new Map<string, Map<string, Bookmark[]>>();

		arr.forEach((x) => {
			if (!x.content.bookTitle) {
				throw new Error("bookTitle must be set");
			}

			const existingBook = m.get(x.content.bookTitle);
			if (existingBook) {
				const existingChapter = existingBook.get(x.content.title);

				if (existingChapter) {
					existingChapter.push(x.bookmark);
				} else {
					existingBook.set(x.content.title, [x.bookmark]);
				}
			} else {
				m.set(
					x.content.bookTitle,
					new Map<string, Bookmark[]>().set(x.content.title, [
						x.bookmark,
					]),
				);
			}
		});

		return m;
	}

	// Efficiently fetches highlights for a single book.
	//
	// The naive approach (getAllHighlight + filter) fetches every bookmark in the
	// database and issues 1-4 DB queries per bookmark to resolve its content,
	// then discards all results except the target book. For a device with many
	// books this is extremely wasteful.
	//
	// Instead we:
	//   1. Fetch only this book's bookmarks via a filtered SQL query (1 DB call).
	//   2. Fetch all content entries for the book ordered by ContentID (1 DB call).
	//   3. Resolve content associations entirely in-memory — O(M) per bookmark
	//      where M is the number of chapters, rather than issuing further DB calls.
	async getHighlightsByBookTitle(
		bookTitle: string,
		sortByChapterProgress?: boolean,
		sortByChapterOrder = true,
	): Promise<Highlight[]> {
		const [bookmarks, allContents] = await Promise.all([
			this.repo.getBookmarksByBookTitle(bookTitle, sortByChapterProgress),
			this.repo.getAllContentByBookTitleOrderedByContentId(bookTitle),
		]);

		// Build an exact-match index for O(1) lookups.
		const contentById = new Map<string, Content>(
			allContents.map((c) => [c.contentId, c]),
		);

		const highlights: Highlight[] = [];
		for (const bookmark of bookmarks) {
			highlights.push(
				this.resolveHighlightInMemory(
					bookmark,
					bookTitle,
					contentById,
					allContents,
				),
			);
		}

		// If sortByChapterOrder is enabled, sort by VolumeIndex (the explicit
		// EPUB spine index Kobo stores in the content table). This is immune to
		// ContentID string-ordering quirks on books with non-sequential filenames.
		// Fall back to ContentID comparison when VolumeIndex is absent.
		// Highlights within the same chapter keep their SQL-determined order.
		if (sortByChapterOrder) {
			highlights.sort((a, b) => {
				const aVol = a.content.volumeIndex;
				const bVol = b.content.volumeIndex;
				if (aVol != null && bVol != null) return aVol - bVol;
				if (aVol != null) return -1;
				if (bVol != null) return 1;
				return a.content.contentId.localeCompare(b.content.contentId);
			});
		}

		return highlights;
	}

	// In-memory equivalent of createHighlightFromBookmark + findRightContentForBookmark,
	// using pre-fetched content data to avoid per-bookmark DB queries.
	private resolveHighlightInMemory(
		bookmark: Bookmark,
		bookTitle: string,
		contentById: Map<string, Content>,
		allContents: Content[], // ordered by ContentID
	): Highlight {
		// 1. Exact match.
		let content = contentById.get(bookmark.contentId) ?? null;

		// 2. Fuzzy match: find a content entry whose ContentID contains the bookmark's ContentID.
		if (!content) {
			content =
				allContents.find((c) =>
					c.contentId.includes(bookmark.contentId),
				) ?? null;
		}

		if (!content) {
			console.warn(
				`bookmark seems to link to a non existing content: ${bookmark.contentId}`,
			);
			return {
				bookmark,
				content: {
					title: this.unknownBookTitle,
					contentId: bookmark.contentId,
					chapterIdBookmarked: "false",
					bookTitle: this.unknownBookTitle,
				},
			};
		}

		// 3. If chapterIdBookmarked is null, walk the sorted content list to find
		//    the right chapter — mirrors findRightContentForBookmark logic.
		if (content.chapterIdBookmarked == null) {
			content = this.findRightContentInMemory(
				bookmark,
				content,
				allContents,
			);
		}

		return { bookmark, content };
	}

	// In-memory equivalent of findRightContentForBookmark.
	private findRightContentInMemory(
		bookmark: Bookmark,
		originalContent: Content,
		allContents: Content[], // ordered by ContentID
	): Content {
		// Mirror getFirstContentLikeContentIdWithBookmarkIdNotNull:
		// find a content whose ContentID starts with originalContent's ContentID
		// and has chapterIdBookmarked set.
		const potential = allContents.find(
			(c) =>
				c.contentId.startsWith(originalContent.contentId) &&
				c.chapterIdBookmarked != null,
		);
		if (potential) return potential;

		// Fall back to sequential scan (mirrors the for-loop in findRightContentForBookmark).
		let foundContent: Content | null = null;
		for (const c of allContents) {
			if (c.chapterIdBookmarked) {
				foundContent = c;
			}
			if (c.contentId === bookmark.contentId && foundContent) {
				return foundContent;
			}
		}

		if (foundContent) {
			console.warn(
				`was not able to find chapterIdBookmarked for book ${originalContent.bookTitle}`,
			);
		}

		return originalContent;
	}

	async getAllHighlight(
		sortByChapterProgress?: boolean,
		sortByChapterOrder?: boolean,
	): Promise<Highlight[]> {
		const highlights: Highlight[] = [];

		const bookmarks = await this.repo.getAllBookmark(sortByChapterProgress);
		for (const bookmark of bookmarks) {
			highlights.push(await this.createHighlightFromBookmark(bookmark));
		}

		return highlights.sort((a, b) => {
			if (!a.content.bookTitle || !b.content.bookTitle) {
				throw new Error("bookTitle must be set");
			}

			const bookCmp = a.content.bookTitle.localeCompare(
				b.content.bookTitle,
			);
			if (bookCmp !== 0) return bookCmp;

			if (sortByChapterOrder) {
				const aVol = a.content.volumeIndex;
				const bVol = b.content.volumeIndex;
				if (aVol != null && bVol != null) return aVol - bVol;
				if (aVol != null) return -1;
				if (bVol != null) return 1;
				return a.content.contentId.localeCompare(b.content.contentId);
			}
			return 0;
		});
	}

	async createHighlightFromBookmark(bookmark: Bookmark): Promise<Highlight> {
		let content = await this.repo.getContentByContentId(bookmark.contentId);

		if (content == null) {
			content = await this.repo.getContentLikeContentId(
				bookmark.contentId,
			);
			if (content == null) {
				console.warn(
					`bookmark seems to link to a non existing content: ${bookmark.contentId}`,
				);
				return {
					bookmark: bookmark,
					content: {
						title: this.unknownBookTitle,
						contentId: bookmark.contentId,
						chapterIdBookmarked: "false",
						bookTitle: this.unknownBookTitle,
					},
				};
			}
		}

		if (content.chapterIdBookmarked == null) {
			return {
				bookmark: bookmark,
				content: await this.findRightContentForBookmark(
					bookmark,
					content,
				),
			};
		}

		return {
			bookmark: bookmark,
			content: content,
		};
	}

	private async findRightContentForBookmark(
		bookmark: Bookmark,
		originalContent: Content,
	): Promise<Content> {
		if (!originalContent.bookTitle) {
			throw new Error("bookTitle field must be set");
		}

		const contents =
			await this.repo.getAllContentByBookTitleOrderedByContentId(
				originalContent.bookTitle,
			);
		const potential =
			await this.repo.getFirstContentLikeContentIdWithBookmarkIdNotNull(
				originalContent.contentId,
			);
		if (potential) {
			return potential;
		}

		let foundContent: Content | null = null;

		for (const c of contents) {
			if (c.chapterIdBookmarked) {
				foundContent = c;
			}

			if (c.contentId === bookmark.contentId && foundContent) {
				return foundContent;
			}
		}

		if (foundContent) {
			console.warn(
				`was not able to find chapterIdBookmarked for book ${originalContent.bookTitle}`,
			);
		}

		return originalContent;
	}

	async getAllBooks(): Promise<Map<string, BookDetails>> {
		const books = await this.repo.getAllBookDetails();
		const bookMap = new Map<string, BookDetails>();

		for (const book of books) {
			bookMap.set(book.title, book);
		}

		return bookMap;
	}

	async getAllContentByBookTitle(bookTitle: string): Promise<Content[]> {
		return this.repo.getAllContentByBookTitle(bookTitle);
	}

	// Create an empty content map for books without highlights
	createEmptyContentMap(): Map<chapter, Bookmark[]> {
		return new Map<chapter, Bookmark[]>();
	}

	// Groups sorted highlights into sections using the content table's structure.
	//
	// Section headers are spine items (volumeIndex != null) that are structural
	// containers rather than bookmarkable chapters (chapterIdBookmarked == null)
	// and whose title does not also appear as a bookmarkable chapter title.
	// This reliably identifies Part/Book headings (e.g. "Part One") in any EPUB
	// without requiring duplicate chapter names as a prerequisite.
	//
	// A section is only emitted when it contains at least one highlighted chapter.
	// If no section headers are found in the content table, returns a single
	// null-titled section (flat chapter list, same rendering as before).
	buildSections(
		highlights: Highlight[],
		allContents: Content[],
	): BookSection[] {
		if (highlights.length === 0) {
			return [{ title: null, chapters: [] }];
		}

		// Titles that appear as bookmarkable chapter entries — used to distinguish
		// chapter entries from structural container entries (Parts, Books, etc.).
		const chapterTitles = new Set(
			allContents
				.filter((c) => c.chapterIdBookmarked != null)
				.map((c) => c.title),
		);

		// Sort all spine items (volumeIndex != null) by reading order.
		// This includes both bookmarkable chapters and non-bookmarkable containers.
		const spineItems = allContents
			.filter((c) => c.volumeIndex != null)
			.sort((a, b) => {
				if (a.volumeIndex != null && b.volumeIndex != null)
					return a.volumeIndex - b.volumeIndex;
				if (a.volumeIndex != null) return -1;
				if (b.volumeIndex != null) return 1;
				return a.contentId.localeCompare(b.contentId);
			});

		// Scan spine items in reading order to detect section headers and assign
		// each content entry to its containing section.
		//
		// A section header is a non-bookmarkable spine item whose title does not
		// appear as a chapter title — i.e. it is a structural container (Part, Book).
		const sectionHeaderTitles = new Set<string>();
		const contentToSection = new Map<string, string | null>();
		let currentSection: string | null = null;

		for (const entry of spineItems) {
			const isContainer = entry.chapterIdBookmarked == null;
			const isNotChapter = !chapterTitles.has(entry.title);

			if (isContainer && isNotChapter) {
				currentSection = entry.title;
				sectionHeaderTitles.add(entry.title);
			}

			contentToSection.set(entry.contentId, currentSection);
		}

		// If no section headers were found, return a flat unsectioned chapter list.
		if (sectionHeaderTitles.size === 0) {
			const chapterMap = new Map<string, Bookmark[]>();
			for (const h of highlights) {
				if (!chapterMap.has(h.content.title))
					chapterMap.set(h.content.title, []);
				chapterMap.get(h.content.title)!.push(h.bookmark);
			}
			return [{ title: null, chapters: [...chapterMap.entries()] }];
		}

		// Group highlights into sections, preserving VolumeIndex-sorted order.
		// Sections with no highlighted chapters are omitted automatically (they
		// never appear in sectionOrder because no highlight maps to them).
		const sectionOrder: (string | null)[] = [];
		const sectionChapters = new Map<
			string | null,
			Map<string, Bookmark[]>
		>();

		for (const h of highlights) {
			// Skip highlights whose resolved content entry is a section header
			// (rare — would mean a user highlighted text inside a Part heading).
			if (sectionHeaderTitles.has(h.content.title)) continue;

			const sectionKey =
				contentToSection.get(h.content.contentId) ?? null;

			if (!sectionChapters.has(sectionKey)) {
				sectionOrder.push(sectionKey);
				sectionChapters.set(sectionKey, new Map());
			}

			const chapterMap = sectionChapters.get(sectionKey)!;
			if (!chapterMap.has(h.content.title))
				chapterMap.set(h.content.title, []);
			chapterMap.get(h.content.title)!.push(h.bookmark);
		}

		return sectionOrder.map((title) => ({
			title,
			chapters: [
				...(sectionChapters.get(title) ?? new Map()).entries(),
			],
		}));
	}
}
