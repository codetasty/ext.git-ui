/* global define, $ */
"use strict";

define(function(require, exports, module) {
	const EventEmitter = require('core/events').EventEmitter;
	
	const Socket = require('core/socket').workspaces;
	
	const Tree = require('modules/explorer/tree');
	
	const FileStatus = {
		STAGED: "STAGED",
		UNMODIFIED: "UNMODIFIED",
		IGNORED: "IGNORED",
		UNTRACKED: "UNTRACKED",
		MODIFIED: "MODIFIED",
		ADDED: "ADDED",
		DELETED: "DELETED",
		RENAMED: "RENAMED",
		COPIED: "COPIED",
		UNMERGED: "UNMERGED"
	};
	
	const FileStatusNames = {
		ADDED: "New file",
		COPIED: "Copied",
		DELETED: "Deleted",
		IGNORED: "Ignored",
		MODIFIED: "Modified",
		RENAMED: "Renamed",
		STAGED: "Staged",
		UNMERGED: "Unmerged",
		UNMODIFIED: "Unmodified",
		UNTRACKED: "Untracked",
	};
	
	class ShellEscapedArg {
		constructor(arg) {
			this.arg = arg;
		}
		
		toString() {
			return this.arg;
		}
	}
	
	class Branch {
		constructor(name, remote, isCurrent) {
			this.name = name;
			this.remote = remote || null;
			this.isCurrent = isCurrent || false;
		}
		
		get isMaster() {
			return this.name === 'master';
		}
	}
	
	Branch.tab = 'branch';
	
	class Remote {
		constructor(name, url, isSelected) {
			this.name = name;
			this.url = url;
			this.isSelected = isSelected || false;
		}
		
		get isOrigin() {
			return this.name === 'origin';
		}
	}
	
	Remote.tab = 'remote';
	
	class File extends Tree.File {
		constructor(options) {
			super(options);
			
			this.status = options.status;
		}
		
		get isStaged() {
			return this.status.indexOf(FileStatus.STAGED) !== -1;
		}
		
		set isStaged(value) {
			let index = this.status.indexOf(FileStatus.STAGED);
			
			if (value) {
				index === -1 && this.status.push(FileStatus.STAGED);
			} else {
				index !== -1 && this.status.splice(index, 1);
			}
		}
		
		get isDiff() {
			return this.status.indexOf(FileStatus.UNTRACKED) === -1 &&
			this.status.indexOf(FileStatus.RENAMED) === -1 &&
			this.status.indexOf(FileStatus.DELETED) === -1;
		}
		
		get isDelete() {
			return this.status.indexOf(FileStatus.UNTRACKED) !== -1 ||
			this.status.indexOf(FileStatus.STAGED) !== -1 &&
			this.status.indexOf(FileStatus.ADDED) !== -1;
		}
		
		get isUndo() {
			return !this.isDelete;
		}
		
		updateStatus(status) {
			this.status = status;
		}
	}
	
	/**
	 * GitWorkspace
	 * @desc Holds git data for workspace, can perform actions
	 */
	class GitWorkspace extends EventEmitter {
		constructor(workspaceId, directory) {
			super();
			
			this.workspaceId = workspaceId;
			
			this._status = GitWorkspace.Status.loading;
			this._branch = null;
			this.branches = [];
			this.remotes = [];
			this.files = new Tree.Tree('Workspace');
			this._directory = directory || '/';
			
			this.getSettings = null;
		}
		
		get isLoading() {
			return this._status === GitWorkspace.Status.loading;
		}
		
		get isInit() {
			return this._status === GitWorkspace.Status.init;
		}
		
		get isNotInit() {
			return this._status === GitWorkspace.Status.notInit;
		}
		
		get branch() {
			return this._branch;
		}
		
		set branch(value) {
			this._branch = value;
			
			this.emit('branch', this, value);
		}
		
		get author() {
			var name = this.getSettings().name;
			var email = this.getSettings().email;
			
			return name && email ? name + ' <' + email + '>' : null;
		}
		
		get directory() {
			return this._directory;
		}
		
		set directory(dir) {
			this._directory = dir;
			
			this.status(true);
		}
		
		/**
		 * Data Managment
		 */
		// branches
		$updateBranches(branches) {
			this.branches = branches;
		}
		
		$addBranch(name) {
			if (this.branches.find(item => item.name === name)) {
				return;
			}
			
			let branch = new Branch(name, null);
			
			let index = 0;
			
			this.branches.every((item) => {
				if (branch.name < item.name) {
					return false;
				}
				
				index++;
				return true;
			});
			
			this.branches.splice(index, 0, branch);
			this.emit('branch.add', this, branch, index);
			this.emit('item.add', this, branch, index);
			
			return branch;
		}
		
		$removeBranch(name) {
			let index = this.branches.findIndex(item => item.name === name);
			
			if (index === -1) {
				return;
			}
			
			let branch = this.branches.splice(index, 1)[0];
			
			this.emit('branch.remove', this, branch, index);
			this.emit('item.remove', this, branch, index);
			
			return branch;
		}
		
		$setCurrentBranch(name) {
			if (this.branch === name) {
				return;
			}
			
			let currentIndex = this.branches.findIndex(item => item.isCurrent);
			if (currentIndex !== -1) {
				let current = this.branches[currentIndex];
				current.isCurrent = false;
				this.emit('branch.update', this, current, currentIndex);
				this.emit('item.update', this, current, currentIndex);
			}
			
			let branchIndex = this.branches.findIndex(item => item.name === name);
			if (branchIndex !== -1) {
				let branch = this.branches[branchIndex];
				branch.isCurrent = true;
				this.emit('branch.update', this, branch, branchIndex);
				this.emit('item.update', this, branch, branchIndex);
			}
			
			this.branch = name;
			
			Socket.send('share', {
				id: this.workspaceId,
				event: 'git.branch',
				name: name,
			});
		}
		
		// remotes
		$updateRemotes(remotes) {
			this.remotes = remotes;
		}
		
		$addRemote(name, url) {
			if (this.remotes.find(item => item.name === name)) {
				return;
			}
			
			let remote = new Remote(name, url);
			
			let index = 0;
			
			this.remotes.every((item) => {
				if (remote.isOrigin || (!item.isOrigin && remote.name < item.name)) {
					return false;
				}
				
				index++;
				return true;
			});
			
			this.remotes.splice(index, 0, remote);
			this.emit('remote.add', this, remote, index);
			this.emit('item.add', this, remote, index);
			
			return remote;
		}
		
		$removeRemote(name) {
			let index = this.remotes.findIndex(item => item.name === name);
			
			if (index === -1) {
				return;
			}
			
			let remote = this.remotes.splice(index, 1)[0];
			
			this.emit('remote.remove', this, remote, index);
			this.emit('item.remove', this, remote, index);
			
			return remote;
		}
		
		$selectRemote(name) {
			let currentIndex = this.remotes.findIndex(item => item.isSelected);
			if (currentIndex !== -1) {
				let current = this.remotes[currentIndex];
				
				if (current.name === name) {
					return;
				}
				
				current.isSelected = false;
				this.emit('remote.update', this, current, currentIndex);
				this.emit('item.update', this, current, currentIndex);
			}
			
			let remoteIndex = this.remotes.findIndex(item => item.name === name);
			if (remoteIndex !== -1) {
				let remote = this.remotes[remoteIndex];
				remote.isSelected = true;
				this.emit('remote.update', this, remote, remoteIndex);
				this.emit('item.update', this, remote, remoteIndex);
			}
		}
		
		get selectedRemote() {
			let index = this.remotes.findIndex(item => item.isSelected);
			
			return index == -1 ? {} : { index, remote: this.remotes[index] };
		}
		
		// helpers
		updateTree(files, paths) {
			if (!paths) {
				this.isTreeReset = true;
				this.files.reset();
			}
			
			if (paths) {
				paths = paths.map(path => {
					return path[0] === '/' ? path : '/' + path;
				});
			}
			
			let path;
			files.forEach((item) => {
				path = item.file[0] === '/' ? item.file : '/' + item.file;
				
				let foundOldIndex = paths ? paths.indexOf(path) : -1;
				
				if (foundOldIndex !== -1) {
					paths.splice(foundOldIndex, 1);
				}
				
				let found = this.files.getItem(path);
				
				if (found) {
					found.updateStatus(item.status);
					this.files.update(found, 'state');
					return;
				}
				
				let file = new File({
					path,
					status: item.status,
				});
				
				let folder = this.files.getItem(file.parentPath);
				
				if (!folder) {
					this.createTreeFolder(file.parentPath);
				}
				
				this.files.insert(file);
			});
			
			if (paths) {
				paths.forEach(path => {
					this.files.delete(path);
					
					this.deleteTreeFolderIfEmpty(File.getParentPath(path));
				});
			}
			
			this.isTreeReset = false;
		}
		
		createTreeFolder(path) {
			let parentPath = File.getParentPath(path);
			let parentFolder = this.files.getItem(parentPath);
			
			if (!parentFolder) {
				this.createTreeFolder(parentPath);
			}
			
			let folder = new Tree.Folder({
				path: path,
			});
			
			folder.isExpanded = true;
			
			this.files.insert(folder);
		}
		
		deleteTreeFolderIfEmpty(path) {
			if (path === '/') {
				return;
			}
			
			if ((this.files.data[path] || []).length) {
				return;
			}
			
			this.files.delete(path);
			
			this.deleteTreeFolderIfEmpty(File.getParentPath(path));
		}
		
		/**
		 * Commands
		 */
		command(...args) {
			// escape command
			args = Array.isArray(args[0]) ? args[0] : args;
			args.unshift('git');
			
			for (var i = 0; i < args.length; i++) {
				if (args[i] instanceof ShellEscapedArg || !(/[^A-Za-z0-9_\/:=-]/.test(args[i]))) {
					continue;
				}
				
				args[i] = ("'" + args[i].replace(/'/g, "'\\''") + "'")
				.replace(/^(?:'')+/g, '') // unduplicate single-quote at the beginning
				.replace(/\\'''/g, "\\'"); // remove non-escaped single-quote if there are enclosed between 2 escaped
			}
			
			return Socket.promise('action', {
				id: this.workspaceId,
				path: this.directory,
				action: 'exec',
				command: args.join(' '),
			}, null, 30000).then(res => {
				if (res.stderr) {
					res.stderr = res.stderr.replace(/^(error|fatal): /i, '');
					throw new Error(res.stderr);
				}
				
				return res.stdout;
			});
		}
		
		escapedArg(arg) {
			return new ShellEscapedArg(arg);
		}
		
		parseStatus(lines, parseBranch) {
			var status = {
				initialised: true,
				branch: null,
				files: [],
				needReset: []
			};
			
			lines = (lines || '').split("\n");
			
			if (parseBranch) {
				var first = lines.shift().substr(2);
				var branch = first.trim().match(/^Initial commit on (\S+)/) || first.trim().match(/^([^\. ]+)/);
				if (branch) {
					status.branch = branch[1];
				}
			}
			
			lines.forEach(function(line) {
				var statusStaged = line.substring(0, 1),
					statusUnstaged = line.substring(1, 2),
					fileStatus = [],
					file = line.substring(3).replace(/\"/gi, '');
				
				if (statusStaged !== " " && statusUnstaged !== " " &&
					statusStaged !== "?" && statusUnstaged !== "?") {
					if (file.indexOf("->") !== -1) {
						file = file.split("->")[1].trim();
					}
					
					if (file) {
						status.needReset.push(file);
					}
					return;
				}

				var statusChar;
				if (statusStaged !== " " && statusStaged !== "?") {
					fileStatus.push(FileStatus.STAGED);
					statusChar = statusStaged;
				} else {
					statusChar = statusUnstaged;
				}
				
				switch (statusChar) {
					case " ": fileStatus.push(FileStatus.UNMODIFIED); break;
					case "!": fileStatus.push(FileStatus.IGNORED); break;
					case "?": fileStatus.push(FileStatus.UNTRACKED); break;
					case "M": fileStatus.push(FileStatus.MODIFIED); break;
					case "A": fileStatus.push(FileStatus.ADDED); break;
					case "D": fileStatus.push(FileStatus.DELETED); break;
					case "R": fileStatus.push(FileStatus.RENAMED); break;
					case "C": fileStatus.push(FileStatus.COPIED); break;
					case "U": fileStatus.push(FileStatus.UNMERGED); break;
				}
				
				var display = file,
					io = file.indexOf("->");
				
				if (io !== -1) {
					file = file.substring(io + 2).trim();
				}
				
				status.files.push({
					status: fileStatus,
					file: file,
				});
			});
			
			return status;
		}
		
		status(hard) {
			if (hard) {
				this._status = GitWorkspace.Status.loading;
				this.emit('update', this);
			}
			
			return this.command('status', '-u', '-b', '--porcelain', this.escapedArg('|'), 'head', '-1000').catch(e => {
				this._status = GitWorkspace.Status.notInit;
				
				return null;
			}).then(res => {
				if (res === null || !this.files) {
					return null;
				}
				
				let parsed = this.parseStatus(res, true);
				
				this._status = parsed.initialised ? GitWorkspace.Status.init : GitWorkspace.Status.notInit;
				this.branch = parsed.branch;
				
				this.updateTree(parsed.files);
				
				if (parsed.needReset.length) {
					return this.unstage(parsed.needReset).then(() => {
						return this.statusFiles(parsed.needReset);
					});
				}
				
				return null;
			}).then(res => {
				this.emit('update', this);
			});
		}
		
		statusFiles(path) {
			path = Array.isArray(path) ? path : [path];
			
			return this.command('status', '-u', '--porcelain', ...path).then(res => {
				let parsed = this.parseStatus(res);
				
				this.updateTree(parsed.files, path);
				
				if (parsed.needReset.length) {
					return this.unstage(parsed.needReset).then(() => {
						return this.statusFiles(parsed.needReset);
					});
				}
				
				return parsed;
			});
		}
		
		init() {
			this._status = GitWorkspace.Status.loading;
			this.emit('update', this);
			
			return this.command('init').then(res => {
				return this.status();
			}).catch(e => {
				this._status = GitWorkspace.Status.notInit;
				this.emit('update', this);
				
				throw e;
			});
		}
		
		clone(url) {
			return this.command('clone ' + url + ' .');
		}
		
		// files
		stage(path) {
			path = Array.isArray(path) ? path : [path];
			
			return this.command('add', '-A', ...path);
		}
		
		unstage(path) {
			path = Array.isArray(path) ? path : [path];
			
			return this.command('reset', '--', ...path);
		}
		
		diff(path) {
			let item = this.files.getItem('/' + path);
			
			let args = ['diff', '--no-ext-diff', '--no-color'];
			
			if (item && item.isStaged) {
				args.push('--staged');
			}
			
			args.push('--', path);
			
			return this.command(args);
		}
		
		// commit
		commit(message, amend) {
			let author = this.author;
			
			let args = ['commit', '-m', message];
			
			if (amend) {
				args.push('--amend');
			}
			
			if (author) {
				args.push('--author=' + author);
			}
			
			return this.command(args);
		}
		
		getLastCommitMessage() {
			return this.command('log', '-1', '--pretty=%B');
		}
		
		// branches
		getBranches() {
			return this.command('branch', '--no-color').then((res) => {
				let branches = [];
				let current;
				
				(res || '').split("\n").forEach(line => {
					let name = line.trim();
					let remote = null;
					
					if (!name || name.indexOf("->") !== -1) {
						return;
					}
					
					if (name.indexOf("* ") === 0) {
						name = name.substring(2);
						current = name;
					}
					
					if (name.indexOf("remotes/") === 0) {
						name = name.substring("remotes/".length);
						remote = name.substring(0, name.indexOf("/"));
					}
					
					branches.push(new Branch(name, remote, current === name));
				});
				
				if (!branches.length) {
					branches.push(new Branch('master', null, true));
					current = 'master';
				}
				
				return {
					list: branches,
					current: current,
				};
			});
		}
		
		checkout(branch) {
			return this.command('checkout', branch, '--').then(res => {
				this.$setCurrentBranch(branch);
				
				return res;
			});
		}
		
		checkoutFiles(path) {
			path = Array.isArray(path) ? path : [path];
			
			return this.command('checkout', '--', ...path);
		}
		
		createBranch(branch, origin) {
			return this.command('checkout', '-b', branch, origin || '').then(res => {
				this.$addBranch(branch);
				this.$setCurrentBranch(branch);
				
				return res;
			});
		}
		
		deleteBranch(branch, force) {
			return this.command('branch', '--no-color', '-' + (force ? 'D' : 'd'), branch).then(res => {
				this.$removeBranch(branch);
				
				return res;
			});
		}
		
		mergeBranch(branch, message, noFf) {
			let args = ['merge'];
			
			if (noFf) {
				args.push('--no-ff');
			}
			
			if (message) {
				args.push('-m', message);
			}
			
			args.push(branch);
			
			return this.command(args);
		}
		
		rebaseBranch(branch) {
			return this.command('rebase', '--ignore-date', branch);
		}
		
		// remotes
		getRemotes() {
			return this.command('remote', '-v').then(res => {
				var remotes = [];
				var names = [];
				
				(res || '').split("\n").forEach(line => {
					let [name, url] = line.replace(/\((push|fetch)\)$/, "").trim().split("\t");
					
					if (!name) {
						return;
					}
					
					if (names.indexOf(name) !== -1) {
						return;
					}
					
					remotes.push(new Remote(name, url));
					names.push(name);
				});
				
				remotes.sort((a, b) => {
					if (a.isOrigin) {
						return -1;
					} else if (b.isOrigin) {
						return 1;
					} else {
						return a.name > b.name;
					}
				});
				
				return remotes;
			});
		}
		
		getRemoteBranches(remoteName) {
			return this.command('branch', '-r', '--no-color').then((res) => {
				let branches = [];
				
				(res || '').split("\n").forEach(line => {
					let name = line.trim();
					let remote = null;
					
					if (!name || name.indexOf("->") !== -1) {
						return;
					}
					
					if (name.indexOf(remoteName + "/") === 0) {
						branches.push(name.substr((remoteName + "/").length));
					}
				});
				
				return branches;
			});
		}
		
		createRemote(name, url) {
			return this.command('remote', 'add',  name, url).then(res => {
				this.$addRemote(name, url);
				this.$selectRemote(name);
				
				return res;
			});
		}
		
		deleteRemote(name) {
			return this.command('remote', 'rm', name).then(res => {
				this.$removeRemote(name);
				
				return res;
			});
		}
		
		fetchRemote(name) {
			return this.command('fetch', name);
		}
		
		mergeRemote(remote, branch, ffOnly, noCommit) {
			let args = ['merge'];
			
			if (ffOnly) {
				args.push('--ff-only');
			}
			
			if (noCommit) {
				args.push('--no-commit', '--no-ff');
			}
			
			args.push(remote + '/' + branch);
			
			return this.command(args);
		}
		
		rebaseRemote(remote, branch) {
			return this.command('rebase', remote + '/' + branch);
		}
		
		resetRemote(remote, branch) {
			return this.command('reset', '--soft', remote + '/' + branch);
		}
		
		setRemoteUrl(remote, url) {
			return this.command('remote', 'set-url', remote, url);
		}
		
		pushRemote(remote, branch, force, remove) {
			let args = ['push', remote, branch, '--porcelain'];
			
			if (force) {
				args.push('--force');
			}
			
			if (remove) {
				args.push('--delete');
			}
			
			return this.command(args);
		}
		
		// destroy
		destroy() {
			this.removeAllListeners();
			this.files.destroy();
			this.files = null;
		}
	}
	
	GitWorkspace.Status = {
		loading: 'loading',
		notInit: 'notInit',
		init: 'init',
	};
	
	GitWorkspace.FileStatus = FileStatus;
	
	module.exports = GitWorkspace;
});