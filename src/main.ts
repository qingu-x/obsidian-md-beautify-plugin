import { App, Plugin, PluginSettingTab, Setting, Notice, MarkdownView, Modal, ItemView, WorkspaceLeaf, View, TFile, setIcon, requestUrl } from 'obsidian';
import { t } from './i18n';

// Use defaultMarkdown from web apps store
const defaultMarkdown = `# Welcome to MD Beautify

This is a modern Markdown editor designed for **beautiful layout and presentation**.

## 1. Basic Syntax
**Bold text**

*Italic text*

***Bold and italic text***

~~Strikethrough text~~

==Highlighted text==

This is a [link](https://github.com/qingu-x/md-editor)

## 2. Special Formats
### Subscript and Superscript

Water: H~2~O

Einstein's equation: E=mc^2^

### Emojis
The weather is great today :sunny: 

Let's learn together :books: 

Go for it :rocket:

## 3. Lists
### Unordered List
- Item 1
- Item 2
  - Sub-item 2.1
  - Sub-item 2.2

### Ordered List
1. Step 1
2. Step 2
3. Step 3

## 4. Blockquotes
> This is a level 1 blockquote
> 
> > This is a level 2 blockquote
> > 
> > > This is a level 3 blockquote
> 

> [!TIP]
> This is a tip callout

> [!NOTE]
> This is a note callout

> [!IMPORTANT]
> This is an important callout
`;

const VIEW_TYPE_MDBEAUTIFY_PREVIEW = 'md-beautify-preview-view';
import { createMarkdownParser, processHtml, basicTheme, customDefaultTheme, codeGithubTheme, academicPaperTheme, auroraGlassTheme, bauhausTheme, cyberpunkNeonTheme, knowledgeBaseTheme, luxuryGoldTheme, morandiForestTheme, neoBrutalismTheme, receiptTheme, sunsetFilmTheme, templateTheme } from '@wemd/core';

const allThemes: Record<string, string> = {
	basic: basicTheme + '\n' + customDefaultTheme + '\n' + codeGithubTheme,
	codeGithub: basicTheme + '\n' + codeGithubTheme,
	academicPaper: basicTheme + '\n' + academicPaperTheme + '\n' + codeGithubTheme,
	auroraGlass: basicTheme + '\n' + auroraGlassTheme + '\n' + codeGithubTheme,
	bauhaus: basicTheme + '\n' + bauhausTheme + '\n' + codeGithubTheme,
	cyberpunkNeon: basicTheme + '\n' + cyberpunkNeonTheme + '\n' + codeGithubTheme,
	knowledgeBase: basicTheme + '\n' + knowledgeBaseTheme + '\n' + codeGithubTheme,
	luxuryGold: basicTheme + '\n' + luxuryGoldTheme + '\n' + codeGithubTheme,
	morandiForest: basicTheme + '\n' + morandiForestTheme + '\n' + codeGithubTheme,
	neoBrutalism: basicTheme + '\n' + neoBrutalismTheme + '\n' + codeGithubTheme,
	receipt: basicTheme + '\n' + receiptTheme + '\n' + codeGithubTheme,
	sunsetFilm: basicTheme + '\n' + sunsetFilmTheme + '\n' + codeGithubTheme,
	template: basicTheme + '\n' + templateTheme + '\n' + codeGithubTheme
};

interface ImageHostConfig {
	type: 'official' | 'qiniu' | 'aliyun' | 'tencent' | 's3';
	config: any;
}

interface MDBeautifySettings {
	defaultTheme: string;
	copyAsHtml: boolean;
	customThemeStyles: Record<string, string>;
	activeImageHost: string;
	officialUploadUrl: string;
	imageHostConfigs: Record<string, any>;
	autoUploadImages: boolean;
	customThemes: string[];
	controlsVisible: boolean;
}

const DEFAULT_SETTINGS: MDBeautifySettings = {
	defaultTheme: 'basic',
	copyAsHtml: true,
	customThemeStyles: {},
	activeImageHost: 'official',
	officialUploadUrl: 'https://api.wemd.app/upload',
	imageHostConfigs: {
		official: {},
		qiniu: {},
		aliyun: {},
		tencent: {},
		s3: {}
	},
	autoUploadImages: false,
	customThemes: [],
	controlsVisible: false
}

export default class MDBeautifyPlugin extends Plugin {
	settings: MDBeautifySettings = DEFAULT_SETTINGS;
	parser: any;

	async onload() {
		await this.loadSettings();
		
		this.parser = createMarkdownParser();

		this.registerView(
			VIEW_TYPE_MDBEAUTIFY_PREVIEW,
			(leaf) => new MDBeautifyPreviewView(leaf, this)
		);

		// Add ribbon icons
		const ribbonIconEl = this.addRibbonIcon('eye', t('preview_ribbon_tooltip'), (evt: MouseEvent) => {
			this.activateView();
		});
		ribbonIconEl.addClass('md-beautify-ribbon-class');

		// Add commands
		this.addCommand({
			id: 'copy-beautified',
			name: t('copy_command_name'),
			callback: () => {
				this.copyBeautified();
			}
		});

		this.addCommand({
			id: 'preview-beautified',
			name: t('preview_command_name'),
			callback: () => {
				this.activateView();
			}
		});

		this.addCommand({
			id: 'upload-all-images',
			name: t('command_upload_all_images'),
			callback: () => {
				this.uploadAllImagesInActiveView();
			}
		});

		// Add event listener for paste and drop events
		this.registerEvent(
			this.app.workspace.on('editor-paste', (evt, editor, view) => {
				if (this.settings.autoUploadImages) {
					this.onPaste(evt, editor);
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on('editor-drop', (evt, editor, view) => {
				if (this.settings.autoUploadImages) {
					this.onPaste(evt as any, editor);
				}
			})
		);

		// Add context menu item for manual image upload
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, view) => {
				const line = editor.getLine(editor.getCursor().line);
				// Support both Markdown links and WikiLinks
				const mdRegex = /!\[(.*?)\]\((.*?)\)/g;
				const wikiRegex = /!\[\[(.*?)(?:\|.*?)?\]\]/g;
				
				let match: RegExpExecArray | null = null;
				let fullMatch = "";
				let path = "";

				// Check for Markdown links
				let m;
				while ((m = mdRegex.exec(line)) !== null) {
					if (editor.getCursor().ch >= m.index && editor.getCursor().ch <= m.index + m[0].length) {
						match = m;
						fullMatch = m[0];
						path = m[2];
						break;
					}
				}

				// Check for WikiLinks if no Markdown link found
				if (!match) {
					while ((m = wikiRegex.exec(line)) !== null) {
						if (editor.getCursor().ch >= m.index && editor.getCursor().ch <= m.index + m[0].length) {
							match = m;
							fullMatch = m[0];
							path = m[1];
							break;
						}
					}
				}

				if (match && path) {
					if (!path.startsWith('http://') && !path.startsWith('https://') && !path.startsWith('data:')) {
						menu.addItem((item) => {
							item.setTitle(t('btn_upload'))
								.setIcon('upload-cloud')
								.onClick(async () => {
									await this.uploadImageFromLink(editor, fullMatch, path);
								});
						});
					}
				}
			})
		);

		// Add settings tab
		this.addSettingTab(new MDBeautifySettingTab(this.app, this));
	}

	async onPaste(evt: ClipboardEvent | DragEvent, editor: any) {
		const items = (evt instanceof ClipboardEvent) 
			? evt.clipboardData?.items 
			: evt.dataTransfer?.items;
			
		if (!items) return;

		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (item.type.startsWith('image/')) {
				const file = item.getAsFile();
				if (file) {
					evt.preventDefault();
					
					const notice = new Notice(t('msg_uploading_image'), 0);
					try {
						const url = await this.uploadImage(file);
						editor.replaceSelection(`![image](${url})`);
						notice.hide();
						new Notice(t('msg_upload_success'));
					} catch (err: any) {
						notice.hide();
						new Notice(t('msg_upload_failed') + err.message);
					}
				}
			}
		}
	}

	async uploadImageFromLink(editor: any, fullLink: string, path: string) {
		const notice = new Notice(t('msg_uploading_image'), 0);
		try {
			// Resolve the file from Obsidian vault
			const decodedPath = decodeURIComponent(path);
			const file = this.app.metadataCache.getFirstLinkpathDest(decodedPath, "");
			if (!file) {
				throw new Error("File not found: " + decodedPath);
			}

			// Read file as array buffer
			const arrayBuffer = await this.app.vault.readBinary(file as TFile);
			const blob = new Blob([arrayBuffer], { type: 'image/' + file.extension });
			const fileObj = new File([blob], file.name, { type: 'image/' + file.extension });

			const url = await this.uploadImage(fileObj);
			
			// Replace the link in the editor
			const cursor = editor.getCursor();
			const lineText = editor.getLine(cursor.line);
			const newLineText = lineText.replace(fullLink, `![image](${url})`);
			editor.setLine(cursor.line, newLineText);
			
			notice.hide();
			new Notice(t('msg_upload_success'));
		} catch (err: any) {
			notice.hide();
			new Notice(t('msg_upload_failed') + err.message);
		}
	}

	async uploadImage(file: File | Blob): Promise<string> {
		const host = this.settings.activeImageHost;
		
		if (host === 'official') {
			const arrayBuffer = await file.arrayBuffer();
			const fileName = (file as File).name || 'image.png';
			const contentType = file.type || 'image/png';
			
			// Construct multipart/form-data manually for requestUrl
			const boundary = '----ObsidianBoundary' + Math.random().toString(36).substring(2);
			const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`;
			const footer = `\r\n--${boundary}--`;
			
			const headerUint8 = new TextEncoder().encode(header);
			const footerUint8 = new TextEncoder().encode(footer);
			const bodyUint8 = new Uint8Array(arrayBuffer);
			
			const combinedBody = new Uint8Array(headerUint8.length + bodyUint8.length + footerUint8.length);
			combinedBody.set(headerUint8);
			combinedBody.set(bodyUint8, headerUint8.length);
			combinedBody.set(footerUint8, headerUint8.length + bodyUint8.length);
			
			const response = await requestUrl({
				url: this.settings.officialUploadUrl,
				method: 'POST',
				headers: {
					'Content-Type': `multipart/form-data; boundary=${boundary}`
				},
				body: combinedBody.buffer,
			});
			
			if (response.status !== 200) {
				throw new Error(`Upload failed with status ${response.status}`);
			}
			
			return response.json.url;
		}
		
		throw new Error('Unsupported image host: ' + host);
	}

	async uploadAllImagesInActiveView() {
		let view = this.app.workspace.getActiveViewOfType(MarkdownView);
		
		if (!view) {
			const leaves = this.app.workspace.getLeavesOfType("markdown");
			if (leaves.length > 0) {
				const visibleLeaf = leaves.find(l => (l.view as any).isShowing && (l.view as any).isShowing());
				view = (visibleLeaf?.view || leaves[0].view) as MarkdownView;
			}
		}

		if (!view || !view.file) {
			new Notice(t('no_active_view'));
			return;
		}

		const content = view.editor.getValue();
		// Match both standard markdown images and wikilinks
		// 1. Standard: ![alt](path)
		// 2. Wikilinks: ![[path]] or ![[path|alt]]
		const mdRegex = /!\[(.*?)\]\((?!https?:\/\/)(.*?)\)/g;
		const wikiRegex = /!\[\[(?!https?:\/\/)(.*?)\]\]/g;
		
		const matches: { full: string, alt: string, path: string, index: number }[] = [];
		
		let match;
		while ((match = mdRegex.exec(content)) !== null) {
			matches.push({ full: match[0], alt: match[1], path: match[2], index: match.index });
		}
		while ((match = wikiRegex.exec(content)) !== null) {
			const contentInner = match[1];
			const [path, ...altParts] = contentInner.split('|');
			matches.push({ full: match[0], alt: altParts.join('|'), path: path, index: match.index });
		}

		if (matches.length === 0) {
			new Notice(t('msg_no_local_images'));
			return;
		}

		// Sort matches by index in descending order to replace from bottom up
		matches.sort((a, b) => b.index - a.index);

		new Notice(t('msg_uploading_all', { count: String(matches.length) }));
		
		let newContent = content;
		let successCount = 0;
		let failCount = 0;

		for (const m of matches) {
			try {
				const decodedPath = decodeURIComponent(m.path);
				const file = this.app.metadataCache.getFirstLinkpathDest(decodedPath, view.file.path);
				
				if (file instanceof TFile) {
					const binary = await this.app.vault.readBinary(file);
					const blob = new Blob([binary], { type: 'image/' + file.extension });
					const url = await this.uploadImage(blob);
					
					const replacement = `![${m.alt || 'image'}](${url})`;
					newContent = newContent.substring(0, m.index) + replacement + newContent.substring(m.index + m.full.length);
					successCount++;
				} else {
					console.warn('File not found for path:', m.path, 'decoded:', decodedPath);
					failCount++;
				}
			} catch (err) {
				console.error('Failed to upload', m.path, err);
				failCount++;
			}
		}

		view.editor.setValue(newContent);
		if (failCount > 0) {
			new Notice(t('msg_upload_all_done', { count: String(successCount) }) + ` (${failCount} failed)`);
		} else {
			new Notice(t('msg_upload_all_done', { count: String(successCount) }));
		}
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_MDBEAUTIFY_PREVIEW);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: VIEW_TYPE_MDBEAUTIFY_PREVIEW, active: true });
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	getThemeCss(themeId?: string) {
		const id = themeId || this.settings.defaultTheme;
		// If user has customized this theme, return the custom version
		if (this.settings.customThemeStyles[id]) {
			return this.settings.customThemeStyles[id];
		}
		// Otherwise return the built-in base theme
		return allThemes[id] || allThemes['basic'];
	}

	async copyBeautified() {
		let content = '';
		let sourceViewName = '';

		// 1. Try to get content from active preview view first
		const previewLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_MDBEAUTIFY_PREVIEW);
		const activeLeaf = this.app.workspace.activeLeaf;
		
		let activePreviewView: MDBeautifyPreviewView | null = null;
		if (activeLeaf && activeLeaf.view instanceof MDBeautifyPreviewView) {
			activePreviewView = activeLeaf.view;
		} else if (previewLeaves.length > 0) {
			activePreviewView = previewLeaves[0].view as MDBeautifyPreviewView;
		}

		// 2. Try to get content from the preview view's current source
		const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		
		if (activeMarkdownView) {
			content = activeMarkdownView.editor.getValue();
			sourceViewName = activeMarkdownView.getDisplayText();
		} else {
			// If no active markdown view, check if we have any markdown leaves
			const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
			if (markdownLeaves.length > 0) {
				const mostRecentMarkdownView = markdownLeaves[0].view as MarkdownView;
				content = mostRecentMarkdownView.editor.getValue();
				sourceViewName = mostRecentMarkdownView.getDisplayText();
			}
		}

		if (!content) {
			new Notice(t('no_active_view'));
			return;
		}

		// Remove frontmatter/properties
		content = content.replace(/^---[\s\S]*?---/, '').trim();
		const themeCss = this.getThemeCss();
		
		try {
			const html = this.parser.render(content);
			// Inline styles for copying
			const finalHtml = processHtml(html, themeCss, true);
			
			// Copy to clipboard
			const blob = new Blob([finalHtml], { type: 'text/html' });
			const data = [new ClipboardItem({ 
				'text/html': blob, 
				'text/plain': new Blob([finalHtml], { type: 'text/plain' }) 
			})];
			
			await navigator.clipboard.write(data);
			new Notice(t('copy_success') + (sourceViewName ? `: ${sourceViewName}` : ''));
		} catch (err: any) {
			console.error('MD Beautify copy error:', err);
			new Notice(t('copy_failed') + (err.message || String(err)));
		}
	}

	showPreviewModal() {
		this.activateView();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	updateAllPreviews(force = false) {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_MDBEAUTIFY_PREVIEW);
		leaves.forEach(leaf => {
			if (leaf.view instanceof MDBeautifyPreviewView) {
				leaf.view.updatePreview(force);
			}
		});
	}
}

class MDBeautifyPreviewView extends ItemView {
	plugin: MDBeautifyPlugin;
	previewEl!: HTMLElement;
	styleEl!: HTMLStyleElement;
	scrollContainer!: HTMLElement;
	private lastScrollTime = 0;
	private lastScrollSource: 'editor' | 'preview' | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: MDBeautifyPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return VIEW_TYPE_MDBEAUTIFY_PREVIEW;
	}

	getDisplayText() {
		return t('view_display_text');
	}

	getIcon() {
		return "eye";
	}

	async onOpen() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.classList.add('md-beautify-preview-view');
		container.style.display = 'flex';
		container.style.flexDirection = 'column';
		container.style.height = '100%';

		// Add scoped style element
		this.styleEl = container.createEl('style');

		// Main Controls Container
		const controlsEl = container.createDiv({ cls: 'md-beautify-view-controls' });
		controlsEl.style.padding = '8px';
		controlsEl.style.borderBottom = '1px solid var(--background-modifier-border)';
		controlsEl.style.display = 'flex';
		controlsEl.style.flexDirection = 'column';
		controlsEl.style.gap = '8px';

		// Top Row: Actions
		const actionsRow = controlsEl.createDiv();
		actionsRow.style.display = 'flex';
		actionsRow.style.gap = '8px';
		actionsRow.style.alignItems = 'center';

		const copyBtn = actionsRow.createEl('button', { text: t('btn_copy'), cls: 'mod-cta' });
		copyBtn.style.flex = '1';
		copyBtn.onclick = () => this.plugin.copyBeautified();

		const uploadBtn = actionsRow.createEl('button', { cls: 'clickable-icon' });
		setIcon(uploadBtn, 'upload-cloud');
		uploadBtn.setAttribute('aria-label', t('command_upload_all_images'));
		uploadBtn.onclick = () => this.plugin.uploadAllImagesInActiveView();

		const toggleBtn = actionsRow.createEl('button', { cls: 'clickable-icon' });
		const updateToggleIcon = () => {
			setIcon(toggleBtn, this.plugin.settings.controlsVisible ? 'chevron-up' : 'chevron-down');
			toggleBtn.setAttribute('aria-label', t('btn_toggle_controls'));
		};
		updateToggleIcon();

		toggleBtn.onclick = async () => {
			this.plugin.settings.controlsVisible = !this.plugin.settings.controlsVisible;
			await this.plugin.saveSettings();
			selectorsRow.style.display = this.plugin.settings.controlsVisible ? 'flex' : 'none';
			updateToggleIcon();
		};

		// Bottom Row: Selectors (Initially hidden or shown based on settings)
		const selectorsRow = controlsEl.createDiv();
		selectorsRow.style.display = this.plugin.settings.controlsVisible ? 'flex' : 'none';
		selectorsRow.style.gap = '12px';
		selectorsRow.style.alignItems = 'center';
		selectorsRow.style.paddingTop = '4px';

		// Theme Selector with Label
		const themeContainer = selectorsRow.createDiv();
		themeContainer.style.display = 'flex';
		themeContainer.style.alignItems = 'center';
		themeContainer.style.gap = '4px';
		themeContainer.style.flex = '1';
		themeContainer.createSpan({ text: t('label_theme') + ':' }).style.fontSize = '12px';
		
		const themeSetting = new Setting(themeContainer)
			.addDropdown(dropdown => {
				// Built-in themes
				Object.keys(allThemes).forEach(themeKey => {
					const label = t(`theme_${themeKey}` as any) || themeKey;
					dropdown.addOption(themeKey, label);
				});
				// Custom themes
				this.plugin.settings.customThemes.forEach(themeName => {
					dropdown.addOption(themeName, themeName);
				});

				dropdown.setValue(this.plugin.settings.defaultTheme)
					.onChange(async (value) => {
						this.plugin.settings.defaultTheme = value;
						await this.plugin.saveSettings();
						this.plugin.updateAllPreviews(true);
					});
			});
	themeSetting.infoEl.remove();
	themeSetting.settingEl.style.border = 'none';
	themeSetting.settingEl.style.padding = '0';
	themeSetting.settingEl.style.flex = '1';

		// Host Selector with Label
		const hostContainer = selectorsRow.createDiv();
		hostContainer.style.display = 'flex';
		hostContainer.style.alignItems = 'center';
		hostContainer.style.gap = '4px';
		hostContainer.style.flex = '1';
		hostContainer.createSpan({ text: t('label_host') + ':' }).style.fontSize = '12px';

		const hostSetting = new Setting(hostContainer)
			.addDropdown(dropdown => {
				const hosts = ['official', 'qiniu', 'aliyun', 'tencent', 's3'];
				hosts.forEach(host => {
					const label = t(`host_${host}` as any) || host;
					dropdown.addOption(host, label);
				});
				dropdown.setValue(this.plugin.settings.activeImageHost)
					.onChange(async (value) => {
						this.plugin.settings.activeImageHost = value;
						await this.plugin.saveSettings();
					});
			});
		hostSetting.infoEl.remove();
		hostSetting.settingEl.style.border = 'none';
		hostSetting.settingEl.style.padding = '0';
		hostSetting.settingEl.style.flex = '1';

		this.scrollContainer = container.createDiv({ cls: 'md-beautify-view-preview-scroll' });
		this.scrollContainer.style.flex = '1';
		this.scrollContainer.style.overflowY = 'auto';
		this.scrollContainer.style.backgroundColor = '#ffffff';
		this.scrollContainer.style.padding = '20px';

		this.scrollContainer.addEventListener('scroll', () => {
			if (this.lastScrollSource === 'editor' && Date.now() - this.lastScrollTime < 100) return;
			
			this.lastScrollSource = 'preview';
			this.lastScrollTime = Date.now();
			this.syncPreviewToEditor();
		});

		this.previewEl = this.scrollContainer.createDiv({ cls: 'md-beautify-view-preview-content' });
		
		// Initial update
		this.updatePreview();

		// Listen for changes in active file
		this.registerEvent(
			this.app.workspace.on('editor-change', () => {
				this.updatePreview();
			})
		);
		
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.updatePreview();
				this.setupEditorScrollListener();
			})
		);

		// Obsidian doesn't have a direct 'scroll' event on workspace, 
		// so we need to monitor the active leaf's scroll
		this.registerInterval(
			window.setInterval(() => {
				this.syncScroll();
			}, 100) // Keep as fallback but less frequent
		);

		// Initial listener setup
		this.setupEditorScrollListener();
	}

	private setupEditorScrollListener() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView || !activeView.editor) return;

		const editor = activeView.editor;
		const cm = (editor as any).cm;
		const scrollDOM = cm?.scrollDOM || (editor as any).scrollDOM;

		if (scrollDOM && !scrollDOM.dataset.mdBeautifyHasListener) {
			scrollDOM.dataset.mdBeautifyHasListener = 'true';
			this.registerDomEvent(scrollDOM, 'scroll', () => {
				this.syncScroll();
			});
		}
	}

	private syncScroll() {
		if (!this.scrollContainer) return;

		// If we recently scrolled the preview, don't let the editor sync back immediately
		if (this.lastScrollSource === 'preview' && Date.now() - this.lastScrollTime < 150) {
			return;
		}

		// Try to find the active or most recent markdown view
		let activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		
		if (!activeView) {
			const leaves = this.app.workspace.getLeavesOfType("markdown");
			if (leaves.length > 0) {
				const visibleLeaf = leaves.find(l => (l.view as any).isShowing && (l.view as any).isShowing());
				activeView = (visibleLeaf?.view || leaves[0].view) as MarkdownView;
			}
		}

		if (!activeView || !activeView.editor) return;

		const editor = activeView.editor;
		
		try {
			let ratio = 0;
			let hasRatio = false;

			// CM6 support
			const cm = (editor as any).cm;
			const scrollDOM = cm?.scrollDOM || (editor as any).scrollDOM;
			
			if (scrollDOM) {
				const { scrollTop, scrollHeight, clientHeight } = scrollDOM;
				const totalScrollableHeight = scrollHeight - clientHeight;
				if (totalScrollableHeight > 0) {
					ratio = scrollTop / totalScrollableHeight;
					hasRatio = true;
				}
			} else if ((editor as any).getScrollInfo) {
				// CM5 fallback
				const scrollInfo = (editor as any).getScrollInfo();
				const totalScrollableHeight = scrollInfo.height - scrollInfo.clientHeight;
				if (totalScrollableHeight > 0) {
					ratio = scrollInfo.top / totalScrollableHeight;
					hasRatio = true;
				}
			}

			if (!hasRatio) return;

			const previewTotalHeight = this.scrollContainer.scrollHeight - this.scrollContainer.clientHeight;
			if (previewTotalHeight <= 0) return;

			const newScrollTop = ratio * previewTotalHeight;
			if (Math.abs(this.scrollContainer.scrollTop - newScrollTop) > 1) {
				this.lastScrollSource = 'editor';
				this.lastScrollTime = Date.now();
				this.scrollContainer.scrollTop = newScrollTop;
			}
		} catch (e) {
			// Ignore
		}
	}

	private syncPreviewToEditor() {
		if (!this.scrollContainer) return;

		const previewTotalHeight = this.scrollContainer.scrollHeight - this.scrollContainer.clientHeight;
		if (previewTotalHeight <= 0) return;

		const ratio = this.scrollContainer.scrollTop / previewTotalHeight;

		let activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			const leaves = this.app.workspace.getLeavesOfType("markdown");
			if (leaves.length > 0) {
				activeView = leaves[0].view as MarkdownView;
			}
		}

		if (!activeView || !activeView.editor) return;

		const editor = activeView.editor;

		try {
			const cm = (editor as any).cm;
			const scrollDOM = cm?.scrollDOM || (editor as any).scrollDOM;

			if (scrollDOM) {
				const { scrollHeight, clientHeight } = scrollDOM;
				const totalScrollableHeight = scrollHeight - clientHeight;
				if (totalScrollableHeight > 0) {
					const newScrollTop = ratio * totalScrollableHeight;
					if (Math.abs(scrollDOM.scrollTop - newScrollTop) > 1) {
						scrollDOM.scrollTop = newScrollTop;
					}
				}
			} else if ((editor as any).getScrollInfo) {
				const scrollInfo = (editor as any).getScrollInfo();
				const totalScrollableHeight = scrollInfo.height - scrollInfo.clientHeight;
				if (totalScrollableHeight > 0) {
					const newScrollTop = ratio * totalScrollableHeight;
					(editor as any).scrollTo(null, newScrollTop);
				}
			}
		} catch (e) {
			// Ignore
		}
	}

	updatePreview(force = false) {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		
		if (activeView) {
			this.renderContent(activeView);
			return;
		}

		if (force) {
			// 如果强制刷新但没有活跃视图，尝试找到第一个 Markdown 视图
			const leaves = this.app.workspace.getLeavesOfType("markdown");
			if (leaves.length > 0 && leaves[0].view instanceof MarkdownView) {
				this.renderContent(leaves[0].view);
				return;
			}
		}

		// 如果没有活跃的 Markdown 视图，检查工作区是否还有任何 Markdown 叶子节点
		const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
		if (markdownLeaves.length === 0) {
			this.previewEl.innerHTML = `<p style="color: #666; text-align: center; padding: 20px;">${t('no_active_markdown')}</p>`;
		}
		// 如果还有 Markdown 视图只是失去了焦点（例如点击了预览视图或侧边栏），则保留当前预览内容
	}

	private renderContent(view: MarkdownView) {
		try {
			// Record current scroll ratio before update
			let scrollRatio = 0;
			if (this.scrollContainer) {
				const total = this.scrollContainer.scrollHeight - this.scrollContainer.clientHeight;
				if (total > 0) {
					scrollRatio = this.scrollContainer.scrollTop / total;
				}
			}

			let content = view.editor.getValue();
			
			// Remove frontmatter/properties
			content = content.replace(/^---[\s\S]*?---/, '').trim();

			const themeCss = this.plugin.getThemeCss();
			
			// Update style element for live preview (non-inlined)
			this.styleEl.innerHTML = themeCss;

			const html = this.plugin.parser.render(content);
			// For preview, we don't inline styles for better performance, and we replace local images with placeholders
			const finalHtml = processHtml(html, themeCss, false, false, true);
			this.previewEl.innerHTML = finalHtml;

			// Restore scroll ratio after content update (with multiple checks for images/rendering)
			if (scrollRatio > 0) {
				const restoreScroll = () => {
					if (!this.scrollContainer) return;
					const newTotal = this.scrollContainer.scrollHeight - this.scrollContainer.clientHeight;
					if (newTotal > 0) {
						this.scrollContainer.scrollTop = scrollRatio * newTotal;
					}
				};

				// Immediate restore
				restoreScroll();
				
				// Delayed restores to account for image loading
				setTimeout(restoreScroll, 100);
				setTimeout(restoreScroll, 300);
				setTimeout(restoreScroll, 1000);
			}
		} catch (err: any) {
			this.previewEl.innerHTML = `<p style="color: red; padding: 20px;">Preview Error: ${err.message || String(err)}</p>`;
		}
	}
}

class ThemeManagerModal extends Modal {
	plugin: MDBeautifyPlugin;
	onChanged: () => void;

	constructor(app: App, plugin: MDBeautifyPlugin, onChanged: () => void) {
		super(app);
		this.plugin = plugin;
		this.onChanged = onChanged;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: t('title_theme_manager') });

		// --- Section: Create New Theme ---
		const createSection = contentEl.createDiv();
		createSection.style.marginBottom = '20px';
		createSection.style.padding = '15px';
		createSection.style.backgroundColor = 'var(--background-secondary)';
		createSection.style.borderRadius = '8px';

		const nameSetting = new Setting(createSection)
			.setName(t('btn_create_theme'))
			.addText(text => text
				.setPlaceholder(t('new_theme_placeholder'))
				.onChange(() => {}));

		const createBtn = createSection.createEl('button', { 
			text: t('btn_create_theme'), 
			cls: 'mod-cta' 
		});
		createBtn.style.marginTop = '10px';
		createBtn.style.width = '100%';
		
		createBtn.onclick = async () => {
			const input = nameSetting.controlEl.querySelector('input') as HTMLInputElement;
			const name = input.value.trim();
			if (name) {
				if (!this.plugin.settings.customThemes.includes(name)) {
					this.plugin.settings.customThemes.push(name);
					this.plugin.settings.customThemeStyles[name] = '';
					await this.plugin.saveSettings();
					input.value = '';
					this.renderThemeList(listContainer);
					this.onChanged();
				}
			} else {
				new Notice(t('msg_enter_theme_name'));
			}
		};

		// --- Section: Theme List ---
		const listContainer = contentEl.createDiv();
		this.renderThemeList(listContainer);
	}

	renderThemeList(container: HTMLElement) {
		container.empty();
		
		if (this.plugin.settings.customThemes.length === 0) return;

		container.createEl('h3', { text: t('tab_theme'), cls: 'md-beautify-list-title' });
		
		const list = container.createDiv({ cls: 'md-beautify-theme-list' });
		list.style.display = 'flex';
		list.style.flexDirection = 'column';
		list.style.gap = '8px';

		this.plugin.settings.customThemes.forEach((themeName: string) => {
			const item = list.createDiv();
			item.style.display = 'flex';
			item.style.justifyContent = 'space-between';
			item.style.alignItems = 'center';
			item.style.padding = '8px 12px';
			item.style.border = '1px solid var(--background-modifier-border)';
			item.style.borderRadius = '4px';

			item.createSpan({ text: themeName });

			const deleteBtn = item.createEl('button', { 
				text: t('btn_delete'), 
				cls: 'mod-warning' 
			});
			deleteBtn.style.padding = '4px 8px';
			deleteBtn.style.fontSize = '12px';

			deleteBtn.onclick = async () => {
				const confirmMsg = t('msg_confirm_delete_theme', { themeName });
				if (confirm(confirmMsg)) {
					// Remove from customThemes
					this.plugin.settings.customThemes = this.plugin.settings.customThemes.filter(t => t !== themeName);
					// Remove style data
					delete this.plugin.settings.customThemeStyles[themeName];
					
					// If it was the default theme, reset to basic
					if (this.plugin.settings.defaultTheme === themeName) {
						this.plugin.settings.defaultTheme = 'basic';
					}

					await this.plugin.saveSettings();
					this.renderThemeList(container);
					this.onChanged();
					this.plugin.updateAllPreviews(true);
				}
			};
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class MDBeautifySettingTab extends PluginSettingTab {
	plugin: MDBeautifyPlugin;
	activeTab: 'general' | 'theme' | 'imagehost' = 'general';

	constructor(app: App, plugin: MDBeautifyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const header = containerEl.createDiv({ cls: 'md-beautify-settings-header' });
		header.createEl('h2', { text: t('settings_header') });

		const nav = containerEl.createDiv({ cls: 'md-beautify-settings-nav' });
		nav.style.display = 'flex';
		nav.style.gap = '10px';
		nav.style.marginBottom = '20px';
		nav.style.borderBottom = '1px solid var(--background-modifier-border)';
		nav.style.paddingBottom = '10px';

		const createTabBtn = (id: typeof this.activeTab, label: string) => {
			const btn = nav.createEl('button', { text: label });
			btn.style.padding = '5px 15px';
			if (this.activeTab === id) {
				btn.style.backgroundColor = 'var(--interactive-accent)';
				btn.style.color = 'var(--text-on-accent)';
			}
			btn.onclick = () => {
				this.activeTab = id;
				this.display();
			};
		};

		createTabBtn('general', t('tab_general'));
		createTabBtn('theme', t('tab_theme'));
		createTabBtn('imagehost', t('tab_image_host'));

		const content = containerEl.createDiv({ cls: 'md-beautify-settings-content' });

		if (this.activeTab === 'general') {
			this.renderGeneralSettings(content);
		} else if (this.activeTab === 'theme') {
			this.renderThemeSettings(content);
		} else if (this.activeTab === 'imagehost') {
			this.renderImageHostSettings(content);
		}
	}

	renderGeneralSettings(container: HTMLElement) {
		new Setting(container)
			.setName(t('setting_copy_as_html'))
			.setDesc(t('setting_copy_as_html_desc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.copyAsHtml)
				.onChange(async (value) => {
					this.plugin.settings.copyAsHtml = value;
					await this.plugin.saveSettings();
				}));
	}

	renderThemeSettings(container: HTMLElement) {
		const themeId = this.plugin.settings.defaultTheme;

		// Theme Management Button
		const actionContainer = container.createDiv({ cls: 'md-beautify-theme-actions' });
		actionContainer.style.marginBottom = '20px';
		actionContainer.style.display = 'flex';
		actionContainer.style.justifyContent = 'flex-start';

		const manageBtn = actionContainer.createEl('button', {
			text: t('btn_manage_themes'),
			cls: 'mod-cta'
		});

		manageBtn.onclick = () => {
			new ThemeManagerModal(this.app, this.plugin, () => {
				this.display();
			}).open();
		};

		new Setting(container)
			.setName(t('setting_base_theme'))
			.addDropdown(dropdown => {
				// Built-in themes
				Object.keys(allThemes).forEach(themeKey => {
					const label = t(`theme_${themeKey}` as any) || themeKey;
					dropdown.addOption(themeKey, label);
				});
				// Custom themes
				this.plugin.settings.customThemes.forEach((themeName: string) => {
					dropdown.addOption(themeName, themeName);
				});

				dropdown.setValue(themeId)
					.onChange(async (value) => {
						this.plugin.settings.defaultTheme = value;
						await this.plugin.saveSettings();
						this.plugin.updateAllPreviews(true);
						this.display();
					});
			});

		const themeLabel = t(`theme_${themeId}` as any) || themeId;

		// Main Editor Container
		const editorContainer = container.createDiv({ cls: 'md-beautify-theme-editor-container' });
		editorContainer.style.display = 'grid';
		editorContainer.style.gridTemplateColumns = '1fr 1fr';
		editorContainer.style.gap = '20px';
		editorContainer.style.height = '70vh';
		editorContainer.style.maxHeight = '600px';
		editorContainer.style.minHeight = '400px';
		editorContainer.style.marginTop = '20px';

		// CSS Editor Section
		const cssSection = editorContainer.createDiv();
		cssSection.style.display = 'flex';
		cssSection.style.flexDirection = 'column';
		cssSection.style.height = '100%';
		cssSection.style.overflow = 'hidden';
		cssSection.createEl('h3', { text: t('setting_custom_css') });
		
		const cssEditor = cssSection.createEl('textarea');
		cssEditor.style.flex = '1';
		cssEditor.style.height = '0'; // Important for flex child overflow
		cssEditor.style.fontFamily = 'var(--font-monospace)';
		cssEditor.style.fontSize = '12px';
		cssEditor.style.padding = '10px';
		cssEditor.style.resize = 'none';
		// Show current effective CSS (either custom or built-in base)
		cssEditor.value = this.plugin.getThemeCss(themeId);

		// Preview Section
		const previewSection = editorContainer.createDiv();
		previewSection.style.display = 'flex';
		previewSection.style.flexDirection = 'column';
		previewSection.style.height = '100%';
		previewSection.style.overflow = 'hidden';
		previewSection.createEl('h3', { text: t('preview_title') });

		const previewFrame = previewSection.createDiv({ cls: 'md-beautify-settings-preview' });
		previewFrame.style.flex = '1';
		previewFrame.style.overflowY = 'auto';
		previewFrame.style.border = '1px solid var(--background-modifier-border)';
		previewFrame.style.padding = '20px';
		previewFrame.style.backgroundColor = '#ffffff';

		const previewStyle = previewFrame.createEl('style');
		const previewContent = previewFrame.createDiv();

		const updateSettingsPreview = () => {
			const css = this.plugin.getThemeCss(themeId);
			// Wrap styles to scope them to preview frame
			previewStyle.innerHTML = css.replace(/#wemd/g, '.md-beautify-preview-wrapper');
			
			const html = this.plugin.parser.render(defaultMarkdown);
			previewContent.innerHTML = `<div class="md-beautify-preview-wrapper">${html}</div>`;
		};

		// Initial preview
		updateSettingsPreview();

		// Auto save and live sync with debounce
		let debounceTimer: any;
		cssEditor.oninput = () => {
			clearTimeout(debounceTimer);
			debounceTimer = setTimeout(async () => {
				this.plugin.settings.customThemeStyles[themeId] = cssEditor.value;
				await this.plugin.saveSettings();
				updateSettingsPreview();
				this.plugin.updateAllPreviews(true);
			}, 500);
		};
	}

	renderImageHostSettings(container: HTMLElement) {
		const host = this.plugin.settings.activeImageHost;

		new Setting(container)
			.setName(t('setting_auto_upload'))
			.setDesc(t('setting_auto_upload_desc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoUploadImages)
				.onChange(async (value) => {
					this.plugin.settings.autoUploadImages = value;
					await this.plugin.saveSettings();
				}));

		new Setting(container)
			.setName(t('setting_active_image_host'))
			.setDesc(t('setting_active_image_host_desc'))
			.addDropdown(dropdown => {
				const hosts = ['official', 'qiniu', 'aliyun', 'tencent', 's3'];
				hosts.forEach(h => {
					const label = t(`host_${h}` as any) || h;
					dropdown.addOption(h, label);
				});
				dropdown.setValue(host)
					.onChange(async (value) => {
						this.plugin.settings.activeImageHost = value;
						await this.plugin.saveSettings();
						this.display();
					});
			});

		if (host === 'official') {
			container.createEl('p', { text: t('official_host_desc') });
			new Setting(container)
				.setName(t('setting_official_url'))
				.setDesc(t('setting_official_url_desc'))
				.addText(text => text
					.setPlaceholder('https://api.wemd.app/upload')
					.setValue(this.plugin.settings.officialUploadUrl)
					.onChange(async (value) => {
						this.plugin.settings.officialUploadUrl = value;
						await this.plugin.saveSettings();
					}));
		} else {
			this.renderHostConfigFields(container, host);
		}
	}

	renderHostConfigFields(container: HTMLElement, type: string) {
		const config = this.plugin.settings.imageHostConfigs[type] || {};

		if (type === 'qiniu') {
			this.createConfigInput(container, type, 'Access Key', 'accessKey', true);
			this.createConfigInput(container, type, 'Secret Key', 'secretKey', true);
			this.createConfigInput(container, type, 'Bucket', 'bucket');
			this.createConfigInput(container, type, 'Domain', 'domain', false, 'e.g., http://images.yourdomain.com');
		} else if (type === 'aliyun' || type === 'tencent' || type === 's3') {
			this.createConfigInput(container, type, 'Access Key ID', 'accessKeyId', true);
			this.createConfigInput(container, type, 'Secret Access Key', 'secretAccessKey', true);
			this.createConfigInput(container, type, 'Bucket', 'bucket');
			this.createConfigInput(container, type, 'Region', 'region');
			if (type === 's3') {
				this.createConfigInput(container, type, 'Endpoint', 'endpoint');
			}
		}
	}

	createConfigInput(container: HTMLElement, type: string, name: string, key: string, isPassword = false, placeholder = '') {
		const s = new Setting(container)
			.setName(name)
			.addText(text => text
				.setPlaceholder(placeholder)
				.setValue(this.plugin.settings.imageHostConfigs[type][key] || '')
				.onChange(async (value) => {
					this.plugin.settings.imageHostConfigs[type][key] = value;
					await this.plugin.saveSettings();
				}));
		
		if (isPassword) {
			s.controlEl.querySelector('input')!.type = 'password';
		}
	}
}

