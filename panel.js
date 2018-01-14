define(function(require, exports, module) {
	"use strict";
	
	const CollectionCluster = require('collection-cluster');
	
	const Sidepanel = require('core/sidepanel');
	const Scrollbar = require('core/scrollbar');
	const Popup = require('core/popup');
	const Notification = require('core/notification');
	const Workspace = require('core/workspace');
	
	const GitUtils = require('./utils');
	const Cell = require('./cell');
	
	const UI = {
		Merge: {
			template: require('text!./ui/merge.html'),
			props: ['form'],
		},
		Branch: {
			template: require('text!./ui/branch.html'),
			props: ['form'],
		},
		Remote: {
			template: require('text!./ui/remote.html'),
			props: ['form'],
		},
		Pull: {
			template: require('text!./ui/pullPush.html'),
			props: ['form'],
		},
		Push: {
			template: require('text!./ui/pullPush.html'),
			props: ['form'],
		},
	};
	
	/**
	 * GitPanel
	 * @desc Sidepanel for git
	 */
	class GitPanel extends Sidepanel {
		constructor(...args) {
			super(...args);
			
			this.el.classList.add('extension-git-panel');
			
			this.toolbar = $(`<ul class="panel-toolbar background-color-bg">
				<li class="devicons devicons-git_commit" data-name="file"></li>
				<li class="devicons devicons-git_branch" data-name="branch"></li>
				<li data-name="remote">
					<i class="nc-icon-glyph arrows-1_simple-down"></i>
					<i class="nc-icon-glyph arrows-1_simple-up"></i>
				</li>
				<li class="nc-icon-glyph ui-1_simple-remove" data-name="close"></li>
			</ul>`)[0];
			this.el.appendChild(this.toolbar);
			
			this.content = $(`<div class="panel-content"></div>`)[0];
			this.el.appendChild(this.content);
			
			for (let i = 0; i < this.toolbar.children.length; i++) {
				this.toolbar.children[i]
				.addEventListener('click', this.onSelectTab.bind(this));
			}
			
			this._git = null;
			this.selectedTab = null;
			
			this.message = $(`<div class="message"></div>`)[0];
			this.content.appendChild(this.message);
			
			this.list = $(`<ul class="list"></ul>`)[0];
			this.content.appendChild(this.list);
			
			this.bottombar = $(`<div class="bottombar"></div>`)[0];
			this.content.appendChild(this.bottombar);
			
			this.onItemAdd = this.onItemAdd.bind(this);
			this.onItemRemove = this.onItemRemove.bind(this);
			this.onItemUpdate = this.onItemUpdate.bind(this);
			
			this.onTreeListUpdate = this.onTreeListUpdate.bind(this);
		}
		
		setup() {
			// collection
			this.collection = new CollectionCluster.Collection(this.list, {
				size: {
					height: 30,
				},
				inset: {
					top: 5,
					bottom: 5,
				},
				getLength: this.getListLength.bind(this),
				cellForIndex: this.cellForIndex.bind(this)
			});
			
			this.collection.registerCell('file', Cell.File);
			this.collection.registerCell('folder', Cell.Folder);
			this.collection.registerCell('branch', Cell.Branch);
			this.collection.registerCell('remote', Cell.Remote);
			this.collection.hook();
			
			// scrollbar
			this.scrollbar = new Scrollbar(this.list, {
				isRelative: true,
			});
		}
		
		get git() {
			return this._git;
		}
		
		set git(git) {
			// unhook old git
			this._git && this.hookGit(this._git, false);
			
			this._git = git;
			
			if (!git || !this.isToggled) {
				return;
			}
			
			this.hookGit(this._git, true);
			
			this.updateSelected();
		}
		
		hookGit(git, toggle) {
			let fn = toggle ? 'on' : 'off';
			
			git
			[fn]('item.add', this.onItemAdd)
			[fn]('item.remove', this.onItemRemove)
			[fn]('item.update', this.onItemUpdate);
			
			if (git.files) {
				git.files.lists.default[fn]('update', this.onTreeListUpdate);
			}
		}
		
		onSelectTab(e) {
			let name = e.currentTarget.getAttribute('data-name');
			
			if (name === 'close') {
				return this.emit('panel.close', this);
			}
			
			if (this.selectedTab === name) {
				return;
			}
			
			this.selectTab(name);
		}
		
		selectTab(name) {
			let tab;
			for (let i = 0; i < this.toolbar.children.length; i++) {
				tab = this.toolbar.children[i];
				tab.classList[tab.getAttribute('data-name') === name ? 'add' : 'remove']('active');
			}
			
			this.selectedTab = name;
			this.updateSelected();
			this.emit('tab', name);
		}
		
		// update selected tab
		updateSelected() {
			this.clear();
			
			if (this.git.isLoading) {
				return this.loading();
			}
			
			if (this.git.isNotInit) {
				return this.notInit();
			}
			
			switch (this.selectedTab) {
				case 'file':
					this.files();
				break;
				case 'branch':
					this.branches();
				break;
				case 'remote':
					this.remotes();
				break;
			}
		}
		
		loading() {
			this.showMessage($('<div class="spinner active size-32"></div>')[0]);
		}
		
		notInit() {
			this.showMessage($(`<div>
				<p>Git repository not initialised.</p>
				<div class="buttons">
					<button class="button action-init size-100">Init</button>
				</div>
				<div class="buttons">
					<button class="button action-settings nc-icon-glyph ui-1_settings-gear-64 size-30"></button>
					<button class="button action-refresh size-70">Refresh</button>
				</div>
			</div>`)[0]);
			
			this.message.querySelector('.action-init').addEventListener('click', () => {
				this.git.init().catch(e => {
					this.error(init, e);
				});
			});
			
			this.message.querySelector('.action-refresh').addEventListener('click', () => {
				this.git.status(true);
			});
			
			this.message.querySelector('.action-settings').addEventListener('click', () => {
				this.settings();
			});
		}
		
		showMessage(message) {
			this.toolbar.style.display = 'none';
			this.message.style.display = 'block';
			
			this.message.appendChild(message);
		}
		
		showContent() {
			this.list.style.display = 'block';
			this.bottombar.style.display = 'block';
		}
		
		error(action, err) {
			Notification.open({
				title: 'Git - ' + action + ' failed',
				type: 'error',
				description: err.message.replace(/(?:\r\n|\r|\n)/g, '<br>'),
			});
		}
		
		settings() {
			let git = this.git;
			
			Popup.form({
				title: 'Git - Settings',
				namespace: 'editor.git',
				action: 'Save',
				content: {
					template: `<form @submit.prevent class="popup-inset">
						<fieldset>
							<dl>
								<dt>Directory</dt>
								<dd><input type="text" v-model="form.data.directory" placeholder="/"></dd>
							</dl>
						</fieldset>
					</form>`,
					props: ['form'],
				},
				form: {
					data: {
						directory: git.directory,
					}
				},
				onSubmit: (popup) => {
					return new Promise((resolve, reject) => {
						if (this.git === git) {
							let workspace = Workspace.storage.sessions[git.workspaceId];
							
							if (workspace) {
								workspace.settings.gitDirectory = popup.form.data.directory;
								Workspace.storage.save();
							}
							
							git.directory = popup.form.data.directory;
						}
						
						resolve();
					});
				}
			});
		}
		
		resize() {
			this.collection.resize();
			this.scrollbar.update();
		}
		
		files() {
			this.showContent();
			
			this.bottombar.appendChild($(`<div class="message"><textarea placeholder="Commit message"></textarea></div>`)[0]);
			
			this.bottombar.appendChild($(`<ul class="items">
				<li><button class="action-settings nc-icon-glyph ui-1_settings-gear-64"></button></li>
				<li><button class="action-refresh nc-icon-glyph arrows-1_refresh-68"></button></li>
				<li><button class="action-amend">Amend</button></li>
				<li class="enlarge"><button class="action-commit">Commit</button></li>
			</ul>`)[0]);
			
			this.bottombar.querySelector('.action-commit').addEventListener('click', () => {
				this.commit();
			});
			
			this.bottombar.querySelector('.action-amend').addEventListener('click', (e) => {
				e.currentTarget.classList.toggle('selected');
				
				if (e.currentTarget.classList.contains('selected')) {
					this.amend();
				} else {
					this.bottombar.querySelector('textarea').value = '';
				}
			});
			
			this.bottombar.querySelector('.action-refresh').addEventListener('click', () => {
				this.refresh();
			});
			
			this.bottombar.querySelector('.action-settings').addEventListener('click', () => {
				this.settings();
			});
			
			this.resize();
			
			let git = this.git;
			
			this.collection.reload();
			this.scrollbar.update();
		}
		
		branches() {
			this.showContent();
			
			this.bottombar.appendChild($(`<ul class="items">
				<li><button class="action-refresh nc-icon-glyph arrows-1_refresh-68"></button></li>
				<li class="enlarge"><button class="action-new">New branch</button></li>
			</ul>`)[0]);
			
			this.bottombar.querySelector('.action-new').addEventListener('click', () => {
				this.newBranch();
			});
			
			this.bottombar.querySelector('.action-refresh').addEventListener('click', () => {
				this.loadBranches();
			});
			
			this.resize();
			
			let git = this.git;
			
			if (!git.branches.length) {
				return this.loadBranches();
			}
			
			this.collection.reload();
			this.scrollbar.update();
		}
		
		loadBranches() {
			let git = this.git;
			
			return git.getBranches().catch(e => {
				return null;
			}).then(res => {
				if (!res) {
					return;
				}
				
				git.$updateBranches(res.list);
				git.branch = res.current;
				
				this.collection.reload();
				this.scrollbar.update();
			});
		}
		
		remotes() {
			this.showContent();
			
			this.bottombar.appendChild($(`<ul class="items">
				<li><button class="action-refresh nc-icon-glyph arrows-1_refresh-68"></button></li>
				<li class="enlarge"><button class="action-fetch">Fetch</button></li>
				<li class="enlarge"><button class="action-pull"><i class="nc-icon-glyph arrows-1_simple-down"></i></button></li>
				<li class="enlarge"><button class="action-push"><i class="nc-icon-glyph arrows-1_simple-up"></i></button></li>
				<li class="enlarge"><button class="action-new nc-icon-glyph ui-2_fat-add"></button></li>
			</ul>`)[0]);
			
			this.bottombar.querySelector('.action-new').addEventListener('click', () => {
				this.newRemote();
			});
			
			this.bottombar.querySelector('.action-refresh').addEventListener('click', () => {
				this.loadRemotes();
			});
			
			this.bottombar.querySelector('.action-fetch').addEventListener('click', () => {
				this.onRemoteFetch();
			});
			
			this.bottombar.querySelector('.action-pull').addEventListener('click', () => {
				this.onRemotePull();
			});
			
			this.bottombar.querySelector('.action-push').addEventListener('click', () => {
				this.onRemotePush();
			});
			
			this.resize();
			
			let git = this.git;
			
			if (!git.remotes.length) {
				return this.loadRemotes();
			}
			
			this.collection.reload();
			this.scrollbar.update();
		}
		
		loadRemotes() {
			let git = this.git;
			
			return git.getRemotes().catch(e => {
				return null;
			}).then(res => {
				if (!res) {
					return;
				}
				
				git.$updateRemotes(res);
				
				if (git.remotes.length) {
					git.remotes[0].isSelected = true;
				}
				
				this.collection.reload();
				this.scrollbar.update();
			});
		}
		
		// get collection list length
		getListLength() {
			if (!this.git || this.isClear) {
				return 0;
			}
			
			switch (this.selectedTab) {
				case 'file':
					// ignore root folder, - 1
					return this.git.files.lists.default.length - 1;
				case 'branch':
					return this.git.branches.length;
				case 'remote':
					return this.git.remotes.length;
				default:
					return 0;
			}
		}
		
		// get collection cell
		cellForIndex(collection, index) {
			let item;
			
			switch (this.selectedTab) {
				case 'file':
					// ignore root folder, + 1
					item = this.git.files.lists.default[index+1];
					break;
				case 'branch':
					item = this.git.branches[index];
					break;
				case 'remote':
					item = this.git.remotes[index];
					break;
			}
			
			let cell = collection.dequeueReusableCell(item.constructor.cell || this.selectedTab);
			cell.delegate = this;
			cell.update(item);
			
			return cell;
		}
		
		// File Cell - delegate
		onFileCheck(cell) {
			let file = cell.item;
			
			if (file.isLoading) {
				return;
			}
			
			let git = this.git;
			
			file.isLoading = true;
			cell.updateState();
			
			git[file.isStaged ? 'unstage' : 'stage'](file.path.substr(1)).then(res => {
				return git.statusFiles(file.path.substr(1));
			}).then(res => {
				file.isLoading = false;
				cell.updateState();
			}).catch(e => {
				file.isLoading = false;
				cell.updateState();
				
				Notification.open({
					title: 'Git - Stage failed',
					type: 'error',
					description: e.message.replace(/(?:\r\n|\r|\n)/g, '<br>'),
				});
			});
		}
		
		onFileDiff(cell) {
			let file = cell.item;
			
			if (file.isLoading || !file.isDiff) {
				return;
			}
			
			let git = this.git;
			
			file.isLoading = true;
			cell.updateState();
			
			git.diff(file.path.substr(1)).then(res => {
				file.isLoading = false;
				cell.updateState();
				
				let diff = GitUtils.formatDiff(res);
				
				Popup.open({
					title: 'Git - Diff',
					content: {
						template: '<div>\
							<div class="extension-git-diff">\
								<table><tbody>' + diff + '</tbody></table>\
							</div>\
						</div>',
						props: ['form'],
					},
					namespace: 'editor.git',
					actions: [],
				});
			}).catch(e => {
				file.isLoading = false;
				cell.updateState();
				
				Notification.open({
					title: 'Git - Diff failed',
					type: 'error',
					description: e.message.replace(/(?:\r\n|\r|\n)/g, '<br>'),
				});
			});
		}
		
		onFileDiscard(cell) {
			let file = cell.item;
			
			if (file.isLoading) {
				return;
			}
			
			let git = this.git;
			
			Popup.confirm({
				title: 'Confirm',
				message: 'Are you sure to discard changes in <strong>%s</strong> file?'.sprintfEscape(file.name),
				confirm: 'Discard',
				onConfirm: () => {
					file.isLoading = true;
					cell.updateState();
					
					git.unstage(file.path.substr(1)).then(res => {
						return git.checkoutFiles(file.path.substr(1));
					}).then(res => {
						git.updateTree([], [file.path.substr(1)]);
					}).catch(e => {
						file.isLoading = false;
						cell.updateState();
						
						Notification.open({
							title: 'Git - Discard failed',
							type: 'error',
							description: e.message.replace(/(?:\r\n|\r|\n)/g, '<br>'),
						});
					});
				},
			});
		}
		
		// Branch Cell - delegate
		onBranchSelect(cell) {
			let branch = cell.item;
			
			if (branch.isLoading || branch.isCurrent) {
				return;
			}
			
			let git = this.git;
			
			branch.isLoading = true;
			cell.updateState();
			
			git.checkout(branch.name).then(res => {
				branch.isLoading = false;
				cell.updateState();
			}).catch(e => {
				branch.isLoading = false;
				cell.updateState();
				
				Notification.open({
					title: 'Git - Checkout failed',
					type: 'error',
					description: e.message.replace(/(?:\r\n|\r|\n)/g, '<br>'),
				});
			});
		}
		
		onBranchDelete(cell, force) {
			let branch = cell.item;
			
			if (branch.isLoading || branch.isCurrent || branch.isMaster) {
				return;
			}
			
			let git = this.git;
			
			Popup.confirm({
				title: 'Confirm',
				message: 'Are you sure to delete <strong>%s</strong> branch?'.sprintfEscape(branch.name),
				confirm: 'Delete',
				onConfirm: () => {
					branch.isLoading = true;
					cell.updateState();
					
					git.deleteBranch(branch.name, force).catch(e => {
						branch.isLoading = false;
						cell.updateState();
						
						Notification.open({
							title: 'Git - Delete branches failed',
							type: 'error',
							description: e.message.replace(/(?:\r\n|\r|\n)/g, '<br>'),
						});
					});
				},
			});
		}
		
		onBranchMerge(cell) {
			let branch = cell.item;
			
			if (branch.isLoading || branch.isCurrent) {
				return;
			}
			
			let git = this.git;
			
			Popup.form({
				title: 'Merge branch - ' + git.branch + ' ... ' + branch.name,
				action: 'Merge',
				content: UI.Merge,
				form: {
					currentBranch: git.branch,
					mergeBranch: branch.name,
					data: {
						message: '',
						rebase: false,
						noff: false,
					}
				},
				onSubmit: (popup) => {
					return git[popup.form.data.rebase ? 'rebaseBranch' : 'mergeBranch']
					(branch.name, popup.form.data.message, popup.form.data.noff)
					.then(res => {
						Popup.close(popup);
						
						Notification.open({
							title: 'Git - Branches merged',
							type: 'success',
							autoClose: true,
							description: res.indexOf('up-to-date.') !== -1 ? res : '',
						});
					});
				}
			});
		}
		
		newBranch() {
			let git = this.git;
			
			Popup.form({
				title: 'New branch',
				action: 'Create',
				content: UI.Branch,
				form: {
					branches: git.branches.map(item => item.name),
					data: {
						origin: git.branch,
						name: '',
					}
				},
				onSubmit: (popup) => {
					return git.createBranch(popup.form.data.name, popup.form.data.origin)
					.then(res => {
						Popup.close(popup);
					});
				}
			});
		}
		
		// Remote Cell - delegate
		onRemoteSelect(cell) {
			let remote = cell.item;
			
			if (remote.isSelected) {
				return;
			}
			
			this.git.$selectRemote(remote.name);
		}
		
		onRemoteDelete(cell) {
			let remote = cell.item;
			
			if (remote.isLoading) {
				return;
			}
			
			let git = this.git;
			
			Popup.confirm({
				title: 'Confirm',
				message: 'Are you sure to delete <strong>%s</strong> remote?'.sprintfEscape(remote.name),
				confirm: 'Delete',
				onConfirm: () => {
					remote.isLoading = true;
					cell.updateState();
					
					git.deleteRemote(remote.name).catch(e => {
						remote.isLoading = false;
						cell.updateState();
						
						Notification.open({
							title: 'Git - Delete remote failed',
							type: 'error',
							description: e.message.replace(/(?:\r\n|\r|\n)/g, '<br>'),
						});
					});
				},
			});
		}
		
		onRemoteFetch() {
			let git = this.git;
			let { index, remote } = git.selectedRemote;
			
			if (!remote || remote.isLoading) {
				return;
			}
			
			let cell = this.collection.cellForIndex(index);
			
			remote.isLoading = true;
			cell.updateState();
			
			git.fetchRemote(remote.name).then(res => {
				remote.isLoading = false;
				cell && cell.updateState();
			}).catch(e => {
				remote.isLoading = false;
				cell && cell.updateState();
				
				Notification.open({
					title: 'Git - Fetch failed',
					type: 'error',
					description: e.message.replace(/(?:\r\n|\r|\n)/g, '<br>'),
				});
			});
		}
		
		onRemotePull() {
			let git = this.git;
			let { index, remote } = git.selectedRemote;
			
			if (!remote || remote.isLoading) {
				return;
			}
			
			git.getRemoteBranches(remote.name).then(res => {
				if (!res.length) {
					throw new Error('No remote branches found, please try fetching the remote.');
				}
				
				Popup.form({
					title: 'Pull remote - ' + remote.name,
					action: 'Pull',
					content: UI.Pull,
					form: {
						types: [{
							value: 'default',
							label: 'Default merge',
						}, {
							value: 'avoid',
							label: 'Avoid manual merging',
						}, {
							value: 'commit',
							label: 'Merge without commit',
						}, {
							value: 'rebase',
							label: 'Use rebase',
						}, {
							value: 'soft',
							label: 'Use soft reset',
						}],
						branches: res,
						data: {
							branch: res.indexOf(git.branch) !== -1 ? git.branch : res[0],
							type: 'default',
						}
					},
					onSubmit: (popup) => {
						let { type, branch } = popup.form.data;
						
						return git.fetchRemote(remote.name).then(res => {
							if (['default', 'avoid', 'commit'].indexOf(type) !== -1) {
								return git.mergeRemote(remote.name, branch, type === 'avoid', type === 'commit');
							} else if (type === 'rebase') {
								return git.rebaseRemote(remote.name, branch);
							} else if (type === 'soft') {
								return git.resetRemote(remote.name, branch);
							}
						}).then(res => {
							Popup.close(popup);
							
							if (!res) {
								return;
							}
							
							Notification.open({
								title: 'Git - Pull',
								type: 'success',
								description: res.replace(/(?:\r\n|\r|\n)/g, '<br>'),
							});
						});
					}
				});
			}).catch(e => {
				Notification.open({
					title: 'Git - List branches failed',
					type: 'error',
					description: e.message.replace(/(?:\r\n|\r|\n)/g, '<br>'),
				});
			});
		}
		
		onRemotePush() {
			let git = this.git;
			let { index, remote } = git.selectedRemote;
			
			if (!remote || remote.isLoading) {
				return;
			}
			
			git.getBranches().then(res => {
				Popup.form({
					title: 'Push remote - ' + remote.name,
					action: 'Push',
					content: UI.Push,
					form: {
						types: [{
							value: 'default',
							label: 'Default push',
						}, {
							value: 'force',
							label: 'Forced push',
						}, {
							value: 'delete',
							label: 'Delete remote branch',
						}],
						branches: res.list.map(item => item.name),
						data: {
							branch: git.branch,
							type: 'default',
						}
					},
					onSubmit: (popup) => {
						let { type, branch } = popup.form.data;
						
						return git.pushRemote(remote.name, branch, type === 'force', type === 'delete').then(res => {
							Popup.close(popup);
							
							if (!res) {
								return;
							}
							
							Notification.open({
								title: 'Git - Push',
								type: 'success',
								description: res.replace(/(?:\r\n|\r|\n)/g, '<br>'),
							});
						});
					}
				});
			}).catch(e => {
				Notification.open({
					title: 'Git - List branches failed',
					type: 'error',
					description: e.message.replace(/(?:\r\n|\r|\n)/g, '<br>'),
				});
			});
		}
		
		newRemote() {
			let git = this.git;
			
			Popup.form({
				title: 'New remote',
				action: 'Create',
				content: UI.Remote,
				form: {
					data: {
						name: '',
						url: '',
					}
				},
				onSubmit: (popup) => {
					return git.createRemote(popup.form.data.name, popup.form.data.url)
					.then(res => {
						Popup.close(popup);
					});
				}
			});
		}
		
		// files
		refresh() {
			let refresh = this.bottombar.querySelector('.action-refresh');
			
			if (refresh.classList.contains('loading')) {
				return;
			}
			
			refresh.classList.add('loading');
			refresh.innerHTML = '<span class="spinner active"><span>';
			
			this.git.status().then(() => {
				refresh.classList.remove('loading');
				refresh.innerHTML = '';
			});
		}
		
		commit() {
			let message = this.bottombar.querySelector('textarea').value.trim();
			
			if (!message) {
				return;
			}
			
			let btn = this.bottombar.querySelector('.action-commit');
			
			if (btn.classList.contains('loading')) {
				return;
			}
			
			btn.classList.add('loading');
			btn.innerHTML = '<span class="spinner active"><span>';
			
			let git = this.git;
			
			this.bottombar.querySelector('textarea').value = '';
			
			git.commit(message, this.bottombar.querySelector('.action-amend').classList.contains('selected')).then(res => {
				git.status();
				
				Notification.open({
					title: 'Git - Commit',
					type: 'success',
					description: res.replace(/(?:\r\n|\r|\n)/g, '<br>'),
				});
			}).catch(e => {
				this.error('commit', e);
			}).then(() => {
				btn.classList.remove('loading');
				btn.innerHTML = 'Commit';
			});
		}
		
		amend() {
			let git = this.git;
			
			git.getLastCommitMessage().then(res => {
				let message = this.bottombar.querySelector('textarea');
				
				if (this.git === git && message) {
					message.value = res;
				}
			}).catch(e => {
				
			});
		}
		
		// Collection data pipe
		onItemAdd(git, item, index) {
			if (this.selectedTab !== item.constructor.tab) {
				return;
			}
			
			this.collection.insert(index, 1);
		}
		
		onItemRemove(git, item, index) {
			if (this.selectedTab !== item.constructor.tab) {
				return;
			}
			
			this.collection.delete(index, 1);
		}
		
		onItemUpdate(git, item, index) {
			if (this.selectedTab !== item.constructor.tab) {
				return;
			}
			
			let cell = this.collection.cellForIndex(index);
			cell && cell.updateState();
		}
		
		onTreeListUpdate(type, index, length, insert) {
			if (this.selectedTab !== 'file' || this.git.isTreeReset) {
				return;
			}
			
			switch (type) {
				case 'item':
					// ignore root folder, - 1
					let cell = this.collection.cellForIndex(index-1);
					cell && cell.update(length, insert);
				break;
				
				case 'insert':
				case 'delete':
				case 'deleteInsert':
					// ignore root folder, - 1
					this.collection[type](index-1, length, insert);
					this.scrollbar.update();
				break;
			}
		}
		
		clear() {
			this.isClear = true;
			
			this.toolbar.style.display = 'flex';
			
			this.message.style.display = 'none';
			this.list.style.display = 'none';
			this.bottombar.style.display = 'none';
			
			this.message.innerHTML = '';
			this.bottombar.innerHTML = '';
			
			this.collection.reload();
			
			this.isClear = false;
		}
	}
	
	module.exports = GitPanel;
});