define(function(require, exports, module) {
	"use strict";
	
	// libs
	const Vue = require('vue');
	
	// core
	const ExtensionManager = require('core/extensionManager');
	const EventEmitter = require('core/events').EventEmitter;
	
	const App = require('core/app');
	const Workspace = require('core/workspace');
	
	// modules
	const HomeSettings = require('modules/home/ext/settings');
	
	const Explorer = require('modules/explorer/explorer');
	
	const Editor = require('modules/editor/editor');
	const EditorEditors = require('modules/editor/ext/editors');
	const EditorSession = require('modules/editor/ext/session');
	const EditorToolbar = require('modules/editor/session/toolbar');
	const EditorRevisions = require('modules/editor/ext/revisions');
	
	// git
	const config = require('json!./extension.json');
	const GitWorkspace = require('./workspace');
	const GitPanel = require('./panel');
	
	/**
	 * Extension
	 */
	class Extension extends ExtensionManager.Extension {
		constructor() {
			super(config);
			
			this.toolbarItem = null;
			this.sidepanel = null;
			this.data = {};
			
			this.onResize = this.onResize.bind(this);
			
			this.onWorkspaceConnected = this.onWorkspaceConnected.bind(this);
			this.onWorkspaceReconnect = this.onWorkspaceReconnect.bind(this);
			this.onWorkspaceActive = this.onWorkspaceActive.bind(this);
			this.onWorkspaceDisconnected = this.onWorkspaceDisconnected.bind(this);
			
			this.onGitUpdate = this.onGitUpdate.bind(this);
			this.onGitBranch = this.onGitBranch.bind(this);
			
			this.onPanelOpen = this.onPanelOpen.bind(this);
			this.onPanelClose = this.onPanelClose.bind(this);
			this.onPanelResize = this.onPanelResize.bind(this);
			this.onPanelTab = this.onPanelTab.bind(this);
			
			this.onRevisionsOpen = this.onRevisionsOpen.bind(this);
			this.onRevisionsClose = this.onRevisionsClose.bind(this);
			
			this.onFileUpdate = this.onFileUpdate.bind(this);
			this.onFileSave = this.onFileSave.bind(this);
			this.onShare = this.onShare.bind(this);
		}
	
		init() {
			super.init();
			
			var self = this;
			
			// add settings to menu
			HomeSettings.add(this.name, {
				label: 'Git',
				iconName: 'devicons devicons-git',
				sections: [{
					title: 'Git',
					module: this.path,
					fields: [{
						name: 'name',
						label: 'Name',
						type: 'text'
					}, {
						name: 'email',
						label: 'Email',
						type: 'text'
					}]
				}]
			});
			
			// create persistant toolbar item
			this.toolbarItem = new EditorToolbar.Item({
				name: this.name,
				template: '<li><div class="select"><i class="icon icon-medium devicons devicons-git_branch"></i><span class="text-overflow">master</span><span class="spinner active"></span></div></li>',
				side: 'right',
				priority: 5,
				isPersistant: true,
				onSelect: () => {
					App.toggleSidepanel(this.name);
				}
			});
			
			this.toolbarItem.nameEl = this.toolbarItem.el.querySelector('.text-overflow');
			this.toolbarItem.loaderEl = this.toolbarItem.el.querySelector('.spinner');
			
			this.toolbarItem.el.style.display = 'none';
			
			EditorSession.toolbar.add(this.toolbarItem);
			
			// create sidepanel
			this.sidepanel = new GitPanel(this.name, document.createElement('div'), this.storage.panelWidth);
			this.sidepanel.canOpen = false;
			
			this.sidepanel.on('open', this.onPanelOpen)
			.on('close', this.onPanelClose)
			.on('resize', this.onPanelResize)
			.on('tab', this.onPanelTab);
			
			App.el.appendChild(this.sidepanel.el);
			App.addSidepanel(this.sidepanel);
			
			// setup sidepanel when its in DOM
			this.sidepanel.setup();
			
			App.on('resize', this.onResize);
			
			// setup data binding
			Workspace.callByStatus(Workspace.status.connected, (workspace) => {
				this.onWorkspaceConnected(workspace);
			});
			
			if (Workspace.getActive(true)) {
				this.onWorkspaceActive(Workspace.getActive());
			}
			
			Workspace.on('connect', this.onWorkspaceConnected)
			.on('reconnect', this.onWorkspaceReconnect)
			.on('disconnect', this.onWorkspaceDisconnected)
			.on('active', this.onWorkspaceActive)
			.on('share.git.branch', this.onShare);
			
			// handle revisions
			EditorRevisions.on('open', this.onRevisionsOpen)
			.on('close', this.onRevisionsClose);
			
			// handle file updates
			Explorer.on('new', this.onFileUpdate)
			.on('move', this.onFileUpdate)
			.on('delete', this.onFileUpdate);
			
			EditorEditors.on('save', this.onFileSave);
			
			this.emit('init');
		}
		
		destroy() {
			super.destroy();
			
			// remove settings menu item
			HomeSettings.remove(this.name);
			
			// remove toolbar item
			EditorSession.toolbar.remove(this.toolbarItem);
			this.toolbarItem = null;
			
			// remove sidepanel
			App.removeSidepanel(this.sidepanel);
			this.sidepanel.destroy();
			this.sidepanel = null;
			
			App.off('resize', this.onResize);
			
			// remove data binding
			Workspace.off('connect', this.onWorkspaceConnected)
			.off('reconnect', this.onWorkspaceReconnect)
			.off('disconnect', this.onWorkspaceDisconnected)
			.off('active', this.onWorkspaceActive)
			.off('share.git.branch', this.onShare);
			
			// unbind revisions
			EditorRevisions.off('open', this.onRevisionsOpen)
			.off('close', this.onRevisionsClose);
			
			// unbind file handlers
			Explorer.off('new', this.onFileUpdate)
			.off('move', this.onFileUpdate)
			.off('delete', this.onFileUpdate);
			
			EditorEditors.off('save', this.onFileSave);
			
			// clear data
			this.data = {};
		}
		
		get active() {
			return this.data[Workspace.getActive(true)];
		}
		
		onResize() {
			this.sidepanel.resize();
		}
		
		onWorkspaceConnected(workspace) {
			// git needs access to terminal
			if (!workspace.isTerminal) {
				return;
			}
			
			let directory = Workspace.storage.sessions[workspace.id].settings.gitDirectory;
			
			let git = new GitWorkspace(workspace.id, directory);
			git.on('update', this.onGitUpdate);
			git.on('branch', this.onGitBranch);
			git.getSettings = this.getSettings.bind(this);
			this.data[workspace.id] = git;
			
			git.status();
		}
		
		onWorkspaceReconnect(workspace) {
			let git = this.data[workspace.id];
			
			if (git) {
				git.status();
			}
		}
		
		onWorkspaceDisconnected(workspace) {
			if (this.data[workspace.id]) {
				this.data[workspace.id].destroy();
				delete this.data[workspace.id];
			}
		}
		
		onWorkspaceActive(workspace) {
			this.updateToolbar();
			this.updateSidepanel();
		}
		
		// update sidepanel availability and content
		updateSidepanel() {
			let git = this.active;
			
			if (!git) {
				// if not git available, disable sidepanel
				this.sidepanel.canOpen = false;
				
				// and close it if opened, will call onPanelClose and clear it
				this.sidepanel.isToggled && App.toggleSidepanel(this.name, false);
				
				return;
			}
			
			this.sidepanel.canOpen = true;
			
			if (this.sidepanel.isToggled) {
				this.sidepanel.git = git;
			}
		}
		
		// update toolbar item info
		updateToolbar() {
			let git = this.active;
			
			if (!git || EditorRevisions.isOpened) {
				this.toolbarItem.el.style.display = 'none';
				return;
			}
			
			if (git.isLoading) {
				this.toolbarItem.nameEl.style.display = 'none';
				this.toolbarItem.loaderEl.style.display = 'inline-block';
			} else {
				this.toolbarItem.nameEl.style.display = 'inline';
				this.toolbarItem.loaderEl.style.display = 'none';
				
				this.toolbarItem.nameEl.textContent = git.branch || 'git';
			}
			
			this.toolbarItem.el.style.display = 'inline-block';
		}
		
		// git status updated
		onGitUpdate(git) {
			if (this.active !== git) {
				return;
			}
			
			this.updateSidepanel();
			this.updateToolbar();
		}
		
		// git branch changed
		onGitBranch(git, branch) {
			if (this.active !== git) {
				return;
			}
			
			this.updateToolbar();
		}
		
		// sidepanel events
		onPanelOpen() {
			this.sidepanel.git = this.active;
			this.sidepanel.selectTab(this.storage.sidepanelTab);
		}
		
		onPanelClose() {
			this.sidepanel.git = null;
			this.sidepanel.clear();
		}
		
		onPanelResize(width) {
			this.storage.panelWidth = width;
			this.storage.save();
		}
		
		onPanelTab(name) {
			this.storage.sidepanelTab = name;
			this.storage.save();
		}
		
		// revisions events
		onRevisionsOpen() {
			this.updateToolbar();
		}
		
		onRevisionsClose() {
			this.updateToolbar();
		}
		
		// handle file updates
		onFileUpdate(data) {
			let git = this.data[data.id];
			
			if (!git || !git.isInit) {
				return;
			}
			
			let files = [data.path.substr(1)];
			
			if (data.pathTo) {
				files.push(data.pathTo.substr(1));
			}
			
			git.statusFiles(files).catch(e => {
				// ignore
			});
		}
		
		onFileSave(session) {
			let git = this.data[session.storage.workspaceId];
			
			if (!git || !git.isInit) {
				return;
			}
			
			git.statusFiles(session.storage.path.substr(1)).catch(e => {
				// ignore
			});
		}
		
		// sharing between collaborators
		onShare(data) {
			let git = this.data[data.id];
			
			if (!git || !git.isInit) {
				return;
			}
			
			git.$setCurrentBranch(data.name);
		}
	}

	module.exports = new Extension();
});