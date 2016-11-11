define(function(require, exports, module) {
	var ExtensionManager = require('core/extensionManager');
	
	var App = require('core/app');
	var Socket = require('core/socket');
	var Workspace = require('core/workspace');
	var Notification = require('core/notification');
	var Fn = require('core/fn');
	var FileManager = require('core/fileManager');
	var Popup = require('core/popup');
	
	
	var HomeSettings = require('modules/home/ext/settings');
	var Editor = require('modules/editor/editor');
	var Explorer = require('modules/explorer/explorer');
	var EditorSession = require('modules/editor/ext/session');
	
	var MenuIcon = require('text!./menu.svg');
	
	var GitUtils = require('./utils');
	
	var FILE_STATUS = {
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
	
	var FILE_STATUS_NAMES = {
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
	
	var Extension = ExtensionManager.register({
		name: 'git',
		storage: {
			name: '',
			email: '',
			useVerboseDiff: false,
		},
		css: [
			'extension'
		]
	}, {
		_data: {},
		init: function() {
			var self = this;
			
			GitUtils.setExtension(this);
			
			HomeSettings.add(this.name, {
				label: 'Git',
				icon: MenuIcon,
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
					}, {
						name: 'useVerboseDiff',
						label: 'Show verbose output in diffs',
						type: 'checkbox',
					}]
				}]
			});
			
			Editor.addToMenu('tools', this.name, {
				label: 'Git',
				isAvailable: function() {
					var id = Workspace.getStorage().active;
					
					return id && Workspace.hasTerminal(id);
				},
				observes: ['workspace', this.name],
				children: this.getMenuChildren.bind(this)
			});
			
			Workspace.on('connect', this.onWorkspaceConnected)
			.on('disconnect', this.onWorkspaceDisconnected);
			
			for (var i in Workspace.connections) {
				if (Workspace.connections[i].connected) {
					this.onWorkspaceConnected({id: i});
				}
			}
		},
		destroy: function() {
			HomeSettings.remove(this.name);
			
			Editor.removeFromMenu('tools', this.name);
			
			App.trigger('observe', {name: Extension.name});
			
			Workspace.off('connect', this.onWorkspaceConnected)
			.off('disconnect', this.onWorkspaceDisconnected);
			
			this._data = {};
		},
		getMenuChildren: function() {
			var workspaceId = Workspace.getStorage().active;
			var data = this._data[workspaceId];
			var items = [];
			
			if (data) {
				items.push({
					label: 'Directory: <strong>' + data.directory + '</strong>',
					exec: function() {
						Extension.directory.popup(workspaceId);
					}
				});
			}
			
			items.push({
				label: 'Refresh status',
				spacer: true,
				exec: function() {
					Extension.action.status(workspaceId);
				}
			});
			
			if (data && data.initialised) {
				items.push({
					label: 'Status',
					exec: function() {
						Extension.action.status(workspaceId).done(function() {
							Extension.status.popup(workspaceId);
						});
					}
				}, {
					label: 'Branch: <strong>' + data.branch + '</strong>',
					exec: function() {
						Extension.action.getBranches(workspaceId).done(function() {
							Extension.branches.popup(workspaceId);
						});
					}
				}, {
					label: 'Remotes',
					exec: function() {
						Extension.action.getRemotes(workspaceId).done(function() {
							Extension.remotes.popup(workspaceId);
						});
					}
				}, {
					label: 'History',
					exec: function() {
						Extension.action.getHistory(workspaceId, data.branch, null, null).done(function(out) {
							Extension.history.popup(workspaceId, null, out);
						}).fail(function(err) {
							Extension.onResult(null, err);
						});
					}
				}, {
					label: 'History for active file',
					isAvailable: function() {
						var file = EditorSession.getActive('file');
						
						var session = EditorSession.getStorage().sessions[file];
						
						var directory = Extension._data[workspaceId].directory || '';
						directory = directory == '/' ? '' : directory;
						
						return file && session.workspaceId == workspaceId && session.path.substr(0, directory.length + 1) == directory + '/';
					},
					exec: function() {
						var session = EditorSession.getStorage().sessions[EditorSession.getActive('file')];
						
						if (!session) {
							return;
						}
						
						var directory = Extension._data[workspaceId].directory || '';
						directory = directory == '/' ? '' : directory;
						
						Extension.action.getHistory(workspaceId, data.branch, 0, session.path.substr(directory.length + 1)).done(function(out) {
							Extension.history.popup(workspaceId, session.path, out);
						}).fail(function(err) {
							Extension.onResult(null, err);
						});
					}
				});
			} else {
				items.push({
					label: 'Init',
					exec: function() {
						Extension.action.init(workspaceId).done(function() {
							Notification.open({
								type: 'success',
								title: 'Git',
								description: 'Repository was successfully created.',
								autoClose: true
							});
							
							Extension.action.status(workspaceId);
						});
					}
				}, {
					label: 'Clone',
					exec: function() {
						Extension.clone.popup(workspaceId);
					}
				});
			}
			
			return items;
		},
		onWorkspaceConnected: function(e) {
			var workspaceId = e.id;
			var directory = Workspace.getStorage().sessions[workspaceId].settings.gitDirectory;
			directory = directory ? directory : '/';
			
			Extension._data[workspaceId] = {
				initialised: false,
				branch: null,
				branches: [],
				remotes: [],
				files: [],
				directory: directory
			};
			
			Extension.action.status(workspaceId).always(function() {
				if (Workspace.getStorage().active == workspaceId) {
					App.trigger('observe', {name: Extension.name});
				}
			});
		},
		onWorkspaceDisconnected: function(e) {
			var workspaceId = e.id;
			delete Extension._data[workspaceId];
		},
		update: function(workspaceId, obj) {
			if (!this._data[workspaceId]) {
				return false;
			}
			
			if (obj === null) {
				obj = {
					initialised: false,
					branch: null,
					branches: [],
					remotes: [],
					files: []
				};
			}
			
			for (var i in obj) {
				this._data[workspaceId][i] = obj[i];
			}
		},
		directory: {
			popup: function(workspaceId) {
				var $content = $('<div>\
					<div class="message">\
						<form autocomplete="false"><fieldset>\
							<dl>\
								<dt>Directory</dt>\
								<dd><input type="text" name="input-directory" placeholder="/"></dd>\
							</dl>\
						</fieldset></form>\
						<div class="error"></div>\
					</div>\
					<div class="actions"></div>\
				</div>');
				
				$content.find(':input[name="input-directory"]').val(Extension._data[workspaceId].directory).cautocomplete({
					prependIfNotPresent: '/',
					source: (function() {
						var folders = [];
						
						Editor.$element.find('.editor-explorer .list-workspace[data-workspace="' + workspaceId + '"] .row.folder').each(function() {
							folders.push($(this).attr('data-path'));
						});
						
						return folders;
					}())
				});
				
				$content.find('.actions').append(Popup.createBtn('Save', 'black', function() {
					var directory = $content.find(':input[name="input-directory"]').val().trim();
					if (directory.substr(0, 1) != '/') {
						directory = '/' + directory;
					}
					
					Extension.directory.setPath(workspaceId, directory);
					
					Popup.close($content);
					
					return false;
				}));
				$content.find('.actions').append(Popup.createBtn('Cancel', 'black'));
				
				Popup.open({
					title: 'Git - Directory',
					content: $content,
					namespace: 'editor.git'
				});
			},
			setPath: function(workspaceId, directory) {
				if (Extension._data[workspaceId]) {
					Extension._data[workspaceId].directory = directory;
					
					Workspace.getStorage().sessions[workspaceId].settings.gitDirectory = directory;
					Workspace.saveStorage();
					
					Extension.action.status(workspaceId);
				}
			}
		},
		status: {
			parse: function(lines) {
				var status = {
					initialised: true,
					branch: null,
					files: [],
					needReset: []
				};
				
				lines = (lines || '').split("\n");
				var first = lines.shift().substr(2);
				var branch = first.trim().match(/^Initial commit on (\S+)/) || first.trim().match(/^([^\. ]+)/);
				if (branch) {
					status.branch = branch[1];
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
						fileStatus.push(FILE_STATUS.STAGED);
						statusChar = statusStaged;
					} else {
						statusChar = statusUnstaged;
					}
					
					switch (statusChar) {
						case " ": fileStatus.push(FILE_STATUS.UNMODIFIED); break;
						case "!": fileStatus.push(FILE_STATUS.IGNORED); break;
						case "?": fileStatus.push(FILE_STATUS.UNTRACKED); break;
						case "M": fileStatus.push(FILE_STATUS.MODIFIED); break;
						case "A": fileStatus.push(FILE_STATUS.ADDED); break;
						case "D": fileStatus.push(FILE_STATUS.DELETED); break;
						case "R": fileStatus.push(FILE_STATUS.RENAMED); break;
						case "C": fileStatus.push(FILE_STATUS.COPIED); break;
						case "U": fileStatus.push(FILE_STATUS.UNMERGED); break;
					}
					
					var display = file,
						io = file.indexOf("->");
					
					if (io !== -1) {
						file = file.substring(io + 2).trim();
					}
					
					status.files.push({
						status: fileStatus,
						display: display,
						file: file,
						name: file.substring(file.lastIndexOf("/") + 1)
					});
				});
				
				return status;
			},
			popup: function(workspaceId) {
				var data = Extension._data[workspaceId];
				if (!data) {
					return;
				}
				
				var $content = $('<div>\
					<div class="extension-git-list sscrollbar">\
						<ul></ul>\
					</div>\
					<div class="message">\
						<fieldset>\
							<dl><dd class="full">\
								<input type="text" class="input-message" placeholder="Enter commit message here..">\
							</dd></dl>\
						</fieldset>\
						<div class="error"></div>\
					</div>\
					<div class="actions"></div>\
				</div>');
				
				data.files.forEach(function(file) {
					var folders = file.file.split('/');
					folders.pop();
					var $list = $content.find('.extension-git-list > ul');
					
					var $folder = $list.find('li.git-folder[data-folder="' + folders.join('/') + '"]');
					
					if (!$folder.length) {
						var curFolder = [];
						folders.forEach(function(folder) {
							curFolder.push(folder);
							$folder = $list.find('li.git-folder[data-folder="' + curFolder.join('/') + '"]');
							
							if (!$folder.length) {
								$folder = $('<li class="git-folder" data-folder="' + curFolder.join('/') + '">\
									<div class="inner">\
										<div class="col"><div class="checkbox"><i class="nc-icon-outline ui-1_check"></i></div></div>\
										<div class="col">\
											<div class="name"><stronng>' + folder + '</strong></div>\
										</div>\
									</div>\
									<ul></ul>\
								</li>');
								
								$list.append($folder);
								
								$list = $folder.children('ul');
							} else {
								$list = $folder.children('ul');
							}
						});
					} else {
						$list = $folder.children('ul');
					}
					
					var $file = $('<li class="git-file" data-file="' + file.file + '">\
						<div class="inner">\
							<div class="col"><div class="checkbox"><i class="nc-icon-outline ui-1_check"></i></div></div>\
							<div class="col">\
								<div class="name"><span class="filename"></span> (<span class="status"></span>)</div>\
							</div>\
							<div class="col"></div>\
						</div>\
					</li>');
					
					var allowDiff = file.status.indexOf(FILE_STATUS.UNTRACKED) === -1 &&
						file.status.indexOf(FILE_STATUS.RENAMED) === -1 &&
						file.status.indexOf(FILE_STATUS.DELETED) === -1;
					var allowDelete = file.status.indexOf(FILE_STATUS.UNTRACKED) !== -1 ||
						file.status.indexOf(FILE_STATUS.STAGED) !== -1 &&
						file.status.indexOf(FILE_STATUS.ADDED) !== -1;
					var allowUndo = !allowDelete;
					
					if (allowDiff) {
						$file.find('.col').eq(2).append('<div class="action action-diff">Diff</div>');
					}
					if (allowUndo) {
						$file.find('.col').eq(2).append('<div class="action action-discard">Discard</div>');
					}
					
					$file.find('.name .filename').html(file.name)
					.end().find('.name .status').text((file.status.map(function(status) {
						return FILE_STATUS_NAMES[status];
					}).join(', ')));
					
					if (file.status.indexOf(FILE_STATUS.STAGED) !== -1) {
						$file.addClass('selected');
					}
					
					$list.append($file);
				});
				
				$content.find('.extension-git-list > ul').on('click', '.action-diff', function() {
					var $file = $(this).parents('.git-file').eq(0);
					
					Extension.action.diffFile(workspaceId, $file.attr('data-file')).done(function(out) {
						var diff = GitUtils.formatDiff(out);
						
						var $content = $('<div>\
							<div class="extension-git-diff">\
								<table><tbody></tbody></table>\
							</div>\
						</div>');
						
						$content.find('table tbody').append(diff);
						
						Popup.open({
							title: 'Git - Diff (' + $file.attr('data-file') + ')',
							content: $content,
							namespace: 'editor.git',
						});
					});
				}).on('click', '.action-discard', function() {
					var $file = $(this).parents('.git-file').eq(0);
					
					Popup.confirm({
						title: __('Confirm'),
						content: __('Are you sure to discard changes in <strong>%s</strong> file?', $file.attr('data-file')),
						name: __('Reset'),
						namespace: Extension.name,
						callback: function() {
							Extension.action.unstage(workspaceId, $file.attr('data-file')).done(function() {
								Extension.action.checkout(workspaceId, $file.attr('data-file')).done(function() {
									Extension.action.status(workspaceId, $file.attr('data-file')).done(function(files) {
										Extension.status.update(workspaceId, $file, files);
									});
								});
							})
						}
					});
				});
				
				$content.find('.extension-git-list ul').find('.checkbox').click(function() {
					var $li = $(this).parents('li').eq(0);
					$li.toggleClass('selected');
					
					if ($li.hasClass('git-folder')) {
						$li.find('li')[$li.hasClass('selected') ? 'addClass' : 'removeClass']('selected');
					}
					
					$li.parents('.git-folder').each(function() {
						if (!$(this).children('ul').children('li:not(.selected)').length) {
							$(this).addClass('selected');
						} else {
							$(this).removeClass('selected');
						}
					});
					
					var path = $li.hasClass('git-file') ? $li.attr('data-file') : $li.attr('data-folder') + '/';
					
					Extension.action[$li.hasClass('selected') ? 'stage' : 'unstage'](workspaceId, path).done(function() {
						Extension.action.status(workspaceId, path).done(function(files) {
							Extension.status.update(workspaceId, $li, files);
						});
					});
				}).end().find('.git-folder > .inner .name').click(function() {
					$(this).parents('.git-folder').eq(0).children('ul').stop().slideToggle(300);
				}).end().find('.git-folder').each(function() {
					if (!$(this).find('li.git-file:not(.selected)').length) {
						$(this).addClass('selected');
					} else {
						$(this).removeClass('selected');
					}
					
					if (!$(this).find('li.git-file.selected').length) {
						$(this).children('ul').hide();
					}
				});
				
				var $amend = $('<div class="extension-git-check"><span><i class="nc-icon-outline ui-1_check"></i></span> Amend last commit</div>').click(function() {
					$(this).toggleClass('checked');
					
					
					if ($(this).hasClass('checked')) {
						Extension.action.getLastCommitMessage(workspaceId).done(function(message) {
							if (!$content.find('.input-message').val().trim()) {
								$content.find('.input-message').val(message.trim());
							}
						});
					}
				});
				
				var openPush = false;
				
				var commit = function() {
					var message = $content.find('.input-message').val().trim();
					
					if (!message) {
						$content.find('.error').text('Please, fill commit message in.');
						return false;
					}
					
					if (!$content.find('.extension-git-list li.git-file.selected').length) {
						$content.find('.error').text('No files to commit.');
						return false;
					}
					
					Extension.action.commit(workspaceId, message, $amend.hasClass('checked')).done(function(out) {
						Notification.open({
							type: 'success',
							title: 'Git',
							description: 'Updates were successfully commited.',
							autoClose: true
						});
						
						Extension.action.status(workspaceId);
						
						if (openPush) {
							Extension.action.getRemotes(workspaceId).done(function() {
								Extension.remotes.popup(workspaceId);
							});
						}
					}).fail(function(err) {
						return Extension.onResult(null, err);
					});
					
					Popup.close($content);
					
					return false;
				};
				
				$content.find('.actions').append(Popup.createBtn('Commit', 'black', function() {
					openPush = false;
					return commit();
				}));
				$content.find('.actions').append(Popup.createBtn('Cancel', 'black'));
				$content.find('.actions').append($amend);
				
				Popup.open({
					title: 'Git - Status',
					content: $content,
					namespace: 'editor.git'
				});
				
				$content.find('.input-message').focus();
			},
			update: function(workspaceId, $li, files) {
				var data = Extension._data[workspaceId];
				if (!data) {
					return;
				}
				
				var path = $li.hasClass('git-file') ? $li.attr('data-file') : $li.attr('data-folder') + '/';
				var mustBeEqual = $li.hasClass('git-file');
				var $parent = $li.parent();
				
				if (!files.length) {
					$li.remove();
				}
				
				for (var i = 0; i < files.length; i++) {
					var file = files[i];
					
					var $file = $parent.find('li.git-file[data-file="' + file.file + '"]');
					
					var allowDiff = file.status.indexOf(FILE_STATUS.UNTRACKED) === -1 &&
						file.status.indexOf(FILE_STATUS.RENAMED) === -1 &&
						file.status.indexOf(FILE_STATUS.DELETED) === -1;
					var allowDelete = file.status.indexOf(FILE_STATUS.UNTRACKED) !== -1 ||
						file.status.indexOf(FILE_STATUS.STAGED) !== -1 &&
						file.status.indexOf(FILE_STATUS.ADDED) !== -1;
					var allowUndo = !allowDelete;
					
					var $col = $file.find('.col').eq(2);
					$col.empty();
					
					if (allowDiff) {
						$col.append('<div class="action action-diff">Diff</div>');
					}
					if (allowUndo) {
						$col.append('<div class="action action-discard">Discard</div>');
					}
					
					$file.find('.name .status').text((file.status.map(function(status) {
						return FILE_STATUS_NAMES[status];
					}).join(', ')));
				}
			}
		},
		branches: {
			popup: function(workspaceId) {
				var data = Extension._data[workspaceId];
				if (!data) {
					return;
				}
				
				var $content = $('<div>\
					<div class="extension-git-list sscrollbar" style="height: 160px;">\
						<ul></ul>\
					</div>\
					<div class="message">\
						<fieldset>\
							<dl>\
								<dt>Origin branch</dt>\
								<dd>\
									<select name="input-branch"></select>\
								</dd>\
							</dl>\
							<dl>\
								<dt>Branch name</dt>\
								<dd>\
									<input type="text" name="input-name">\
								</dd>\
							</dl>\
						</fieldset>\
						<div class="error"></div>\
					</div>\
					<div class="actions"></div>\
				</div>');
				
				this.list(workspaceId, $content, data.branches, data.branch);
				
				$content.find('.actions').append(Popup.createBtn('Create branch', 'black', function() {
					var name = $content.find(':input[name="input-name"]').val().trim();
					var originBranch = $content.find(':input[name="input-branch"]').val();
					
					if (!name) {
						$content.find('.error').text('Please, fill name in.');
						return false;
					}
					
					$content.find('.error').html('');
					
					Extension.action.createBranch(workspaceId, name, originBranch).done(function() {
						Extension.action.getBranches(workspaceId).done(function(branches, branch) {
							Extension.branches.list(workspaceId, $content, branches, branch);
							
							$content.find(':input[name="input-name"]').val('');
							
							Extension.action.status(workspaceId);
						});
					}).fail(function(err) {
						Extension.onResult(null, err);
					});
					
					return false;
				}));
				
				Popup.open({
					title: 'Git - Branches',
					content: $content,
					namespace: 'editor.git'
				});
			},
			list: function(workspaceId, $content, branches, branch) {
				var $list = $content.find('.extension-git-list > ul');
				var $select = $content.find(':input[name="input-branch"]');
				var currentBranch = branch;
				
				$list.children().addClass('check').removeClass('selected');
				branches.forEach(function(branch) {
					if ($list.find('.git-item[data-name="' + branch.name + '"]').length) {
						$list.find('.git-item[data-name="' + branch.name + '"]').removeClass('check');
						return;
					}
					
					$select.append('<option value="' + branch.name + '" ' + (branch.name == currentBranch ? 'selected' : '') +'>' + branch.name + '</option>');
					
					if (branch.remote) {
						return;
					}
					
					var $branch = $('<li class="git-item" data-name="' + branch.name + '" data-remote="' + (branch.remote || '') + '">\
						<div class="inner">\
							<div class="col"><div class="radiobox"></div></div>\
							<div class="col"><div class="name"><strong>' + branch.name + '</strong></div></div>\
							<div class="col"></div>\
						</div>\
					</li>');
					
					if (branch.remote) {
						$branch.find('.radiobox').remove();
					} else {
						$branch.find('.col').eq(2).append('<div class="action action-merge">Merge</div>');
					}
					
					if (branch.name != 'master') {
						$branch.find('.col').eq(2).append('<div class="action action-delete nc-icon-outline ui-1_simple-remove"></div>');
					}
					
					$list.append($branch);
				});
				
				$list.children('.check').each(function() {
					var name = $(this).attr('data-name');
					$(this).remove();
					$select.find('option[value="' + name + '"]').remove();
				});
				
				$list.children('[data-name="' + branch + '"]').addClass('selected');
				
				$content.find('.extension-git-list .git-item:not(.binded)')
				.addClass('binded').find('.radiobox').click(function() {
					var $item = $(this).parents('.git-item').eq(0);
					
					if ($item.hasClass('selected')) {
						return;
					}
					
					Extension.action.checkout(workspaceId, $item.find('.name').text()).done(function(out) {
						$item.parent().children().removeClass('selected');
						$item.addClass('selected');
						
						Extension.action.status(workspaceId);
					}).fail(function(err) {
						return Extension.onResult(null, err);
					});
				}).end().find('.action-delete').click(function() {
					var $item = $(this).parents('.git-item').eq(0);
					var name = $item.attr('data-name');
					var remote = $item.attr('data-remote');
					
					Popup.confirm({
						title: 'Git - Delete a branch',
						content: 'Are you sure to delete <strong>' + name + '</strong> branch?',
						name: 'Yes',
						callback: function() {
							Extension.action.deleteBranch(workspaceId, name, true).done(function() {
								Extension.action.getBranches(workspaceId).done(function(branches, branch) {
									Extension.branches.list(workspaceId, $content, branches, branch);
								});
							}).fail(function(err) {
								Extension.onResult(null, err);
							});
						}
					});
				}).end().find('.action-merge').click(function() {
					var $item = $(this).parents('.git-item').eq(0);
					var name = $item.find('.name').text();
					
					Extension.branches.merge(workspaceId, name);
				});
			},
			merge: function(workspaceId, branch) {
				var data = Extension._data[workspaceId];
				if (!data) {
					return;
				}
				
				var $content = $('<div>\
					<div class="message">\
						<fieldset>\
							<dl>\
								<dt>Target branch</dt>\
								<dd><strong>' + data.branch + '</strong></dd>\
							</dl>\
							<dl>\
								<dt>Merge message</dt>\
								<dd>\
									<input type="text" name="input-message" placeholder="Merge branch \'' + branch + '\'">\
								</dd>\
							</dl>\
							<dl>\
								<dt></dt>\
								<dd><label for="git-input-rebase"><input type="checkbox" name="input-rebase" id="git-input-rebase"> Use REBASE</label></dd>\
							</dl>\
							<dl>\
								<dt></dt>\
								<dd><label for="git-input-commit"><input type="checkbox" name="input-noff" id="git-input-commit"> Create a merge commit even when the merge resolves as a fast-forward</label></dd>\
							</dl>\
						</fieldset>\
						<div class="error"></div>\
					</div>\
					<div class="actions"></div>\
				</div>');
				
				$content.find('.actions').append(Popup.createBtn('Merge', 'black', function() {
					var message = $content.find(':input[name="input-message"]').val().trim();
					var rebase = $content.find(':input[name="input-rebase"]').is(':checked');
					var noFf = $content.find(':input[name="input-noff"]').is(':checked');
					
					var $result = Extension.onResult();
					
					if (rebase) {
						Extension.action.rebaseBranch(workspaceId, branch).done(function(out) {
							$result.find('.extension-git-result').html((out || ''));
							Extension.action.status(workspaceId);
						}).fail(function(err) {
							$result.find('.extension-git-result').html((err || ''));
						});
					} else {
						Extension.action.mergeBranch(workspaceId, branch, message, noFf).done(function(out) {
							$result.find('.extension-git-result').html((out || ''));
							Extension.action.status(workspaceId);
						}).fail(function(err) {
							$result.find('.extension-git-result').html((err || ''));
						});
					}
					
					Popup.close($content);
					
					return false;
				}));
				$content.find('.actions').append(Popup.createBtn('Cancel', 'black'));
				
				Popup.open({
					title: 'Git - Merge branch (' + branch + ')',
					content: $content,
					namespace: 'editor.git'
				});
			},
		},
		remotes: {
			popup: function(workspaceId) {
				var data = Extension._data[workspaceId];
				if (!data) {
					return;
				}
				
				var $content = $('<div>\
					<div class="extension-git-list sscrollbar" style="height: 160px;">\
						<ul></ul>\
					</div>\
					<div class="message">\
						<fieldset>\
							<dl>\
								<dt>Name</dt>\
								<dd>\
									<input type="text" name="input-name">\
								</dd>\
							</dl>\
							<dl>\
								<dt>URL</dt>\
								<dd>\
									<input type="text" name="input-url">\
								</dd>\
							</dl>\
						</fieldset>\
						<div class="error"></div>\
					</div>\
					<div class="actions"></div>\
				</div>');
				
				this.list(workspaceId, $content, data.remotes);
				
				$content.find('.actions').append(Popup.createBtn('Create remote', 'black', function() {
					var name = $content.find(':input[name="input-name"]').val().trim();
					var url = $content.find(':input[name="input-url"]').val().trim();
					
					if (!name || !url) {
						$content.find('.error').text('Please, fill name and url in.');
						return false;
					}
					
					Extension.action.createRemote(workspaceId, name, url).done(function() {
						Extension.action.getRemotes(workspaceId).done(function(remotes) {
							Extension.remotes.list(workspaceId, $content, remotes);
							$content.find(':input[name="input-name"]').val('');
							$content.find(':input[name="input-url"]').val('');
						});
					}).fail(function(err) {
						Extension.onResult(null, err);
					});
					
					return false;
				}));
				
				Popup.open({
					title: 'Git - Remotes',
					content: $content,
					namespace: 'editor.git'
				});
			},
			list: function(workspaceId, $content, remotes) {
				var $list = $content.find('.extension-git-list > ul');
				
				$list.children().addClass('check');
				
				remotes.forEach(function(remote) {
					var cleanRemoteUrl = remote.url.replace(/^http(s?):\/\/(.*)\@(.*)$/, 'http$1://$3');
					
					if ($list.find('.git-item[data-name="' + remote.name + '"]').length) {
						$list.find('.git-item[data-name="' + remote.name + '"]').removeClass('check').find('.name').html('<strong>' + remote.name + '</strong> (' + cleanRemoteUrl + ')');
						return;
					}
					
					var $remote = $('<li class="git-item" data-name="' + remote.name + '">\
						<div class="inner">\
							<div class="col"></div>\
							<div class="col"><div class="name"><strong>' + remote.name + '</strong> (' + cleanRemoteUrl + ')</div></div>\
							<div class="col"></div>\
						</div>\
					</li>');
					
					$remote.find('.col').eq(2).append('<div class="action action-fetch">Fetch</div>');
					$remote.find('.col').eq(2).append('<div class="action action-pull">Pull</div>');
					$remote.find('.col').eq(2).append('<div class="action action-push">Push</div>');
					
					$remote.find('.col').eq(2).append('<div class="action action-delete nc-icon-outline ui-1_simple-remove"></div>');
					
					$list.append($remote);
				});
				
				$list.children('.check').remove();
				
				$content.find('.extension-git-list .git-item:not(.binded)')
				.addClass('binded').find('.action-delete').click(function() {
					var $item = $(this).parents('.git-item').eq(0);
					var name = $item.attr('data-name');
					
					Popup.confirm({
						title: 'Git - Delete a remote',
						content: 'Are you sure to delete <strong>' + name + '</strong> remote?',
						name: 'Yes',
						callback: function() {
							Extension.action.deleteRemote(workspaceId, name).done(function() {
								Extension.action.getRemotes(workspaceId).done(function(remotes) {
									Extension.remotes.list(workspaceId, $content, remotes);
								});
							}).fail(function(err) {
								Extension.onResult(null, err);
							});
						}
					});
				}).end().find('.action-fetch').click(function() {
					var $item = $(this).parents('.git-item').eq(0);
					
					Extension.remotes.fetch(workspaceId, $item.attr('data-name'), $content);
				}).end().find('.action-pull').click(function() {
					var $item = $(this).parents('.git-item').eq(0);
					
					Extension.action.getBranches(workspaceId).done(function() {
						Extension.remotes.pull(workspaceId, $item.attr('data-name'), $content);
					});
				}).end().find('.action-push').click(function() {
					var $item = $(this).parents('.git-item').eq(0);
					
					Extension.action.getBranches(workspaceId).done(function() {
						Extension.remotes.push(workspaceId, $item.attr('data-name'), $content);
					});
				});
			},
			fetch: function(workspaceId, remoteName, $remotesContent) {
				var data = Extension._data[workspaceId];
				if (!data) {
					return;
				}
				
				var remote = data.remotes.filter(function(remote) {
					return remote.name == remoteName;
				})[0];
				
				if (!(/^https?:/.test(remote.url))) {
					var $result = Extension.onResult();
					
					Extension.action.fetchRemote(workspaceId, remoteName).done(function(out) {
						Popup.close($result);
					}).fail(function(err) {
						return Extension.resultData($result, null, err);
					});
					
					return false;
				}
				
				var $content = $('<div>\
					<div class="message">\
						<form autocomplete="false"><fieldset>\
						</fieldset></form>\
						<div class="error"></div>\
					</div>\
					<div class="actions"></div>\
				</div>');
				
				this.generateCredentialsInputs($content, remote);
				
				$content.find('.actions').append(Popup.createBtn('Fetch', 'black', function() {
					var url = remote.url;
					var username = ($content.find(':input[name="input-username"]').val() || '').trim();
					var password = ($content.find(':input[name="input-password"]').val() || '').trim();
					var save = $content.find(':input[name="input-save"]').is(':checked');
					
					var urlData = Extension.parseUrl(url, username, password, save);
					var $result = Extension.onResult();
					
					Extension.remotes.fetchWithSettings(workspaceId, remote, urlData, $remotesContent).done(function(out) {
						Popup.close($result);
					}).fail(function(err) {
						return Extension.resultData($result, null, err);
					});
					
					Popup.close($content);
					
					return false;
				}));
				$content.find('.actions').append(Popup.createBtn('Cancel', 'black'));
				
				Popup.open({
					title: 'Git - Fetch',
					content: $content,
					namespace: 'editor.git'
				});
			},
			pull: function(workspaceId, remoteName, $remotesContent) {
				var data = Extension._data[workspaceId];
				if (!data) {
					return;
				}
				
				var remote = data.remotes.filter(function(remote) {
					return remote.name == remoteName;
				})[0];
				
				var $content = $('<div>\
					<div class="message">\
						<form autocomplete="false"><fieldset>\
							<dl>\
								<dt>Branch</dt>\
								<dd><select name="input-branch"></select></dd>\
							</dl>\
							<dl>\
								<dt></dt>\
								<dd><label for="git-input-tracking"><input type="checkbox" name="input-tracking" id="git-input-tracking"> Set this branch as new a new tracking branch</label></dd>\
							</dl>\
							<dl>\
								<dt>Type</dt>\
								<dd>\
									<label for="git-input-default"><input type="radio" name="input-type" id="git-input-default" value="default" checked> Default merge</label>\
									<label for="git-input-avoid"><input type="radio" name="input-type" id="git-input-avoid" value="avoid"> Avoid manual merging</label>\
									<label for="git-input-commit"><input type="radio" name="input-type" id="git-input-commit" value="commit"> Merge without commit</label>\
									<label for="git-input-rebase"><input type="radio" name="input-type" id="git-input-rebase" value="rebase"> Use rebase</label>\
									<label for="git-input-soft"><input type="radio" name="input-type" id="git-input-soft" value="soft"> Use soft reset</label>\
								</dd>\
							</dl>\
						</fieldset></form>\
						<div class="error"></div>\
					</div>\
					<div class="actions"></div>\
				</div>');
				
				this.generateCredentialsInputs($content, remote);
				
				data.branches.forEach(function(branch) {
					if (branch.remote != remoteName) {
						return;
					}
					
					$content.find(':input[name="input-branch"]').append('<option value="' + branch.name.substr(remoteName.length+1) + '">' + branch.name + '</option>');
				});
				
				if ($content.find(':input[name="input-branch"] option[value="' + data.branch + '"]').length) {
					$content.find(':input[name="input-branch"]').val(data.branch);
				}
				
				$content.find('.actions').append(Popup.createBtn('Pull', 'black', function() {
					var branch = $content.find(':input[name="input-branch"]').val();
					var type = $content.find(':input[name="input-type"]:checked').attr('value');
					var tracking = $content.find(':input[name="input-tracking"]').is(':checked');
					
					var url = remote.url;
					var username = ($content.find(':input[name="input-username"]').val() || '').trim();
					var password = ($content.find(':input[name="input-password"]').val() || '').trim();
					var save = $content.find(':input[name="input-save"]').is(':checked');
					
					var urlData = Extension.parseUrl(url, username, password, save);
					
					if (!branch) {
						$content.find('.error').text('Please, select a branch.');
						return false;
					}
					
					var $result = Extension.onResult();
					
					var onDone = function(out) {
						Extension.resultData($result, out, null);
						
						if (tracking) {
							Extension.action.checkout(workspaceId, branch);
						}
					};
					
					var onFail = function(err) {
						Extension.resultData($result, null, err);
					};
					
					Extension.remotes.fetchWithSettings(workspaceId, remote, urlData, $remotesContent).done(function(out) {
						if (['default', 'avoid', 'commit'].indexOf(type) !== -1) {
							Extension.action.mergeRemote(workspaceId, remoteName, branch, type == 'avoid', type == 'commit').done(onDone).fail(onFail);
						} else if (type == 'rebase') {
							Extension.action.rebaseRemote(workspaceId, remoteName, branch).done(onDone).fail(onFail);
						} else if (type == 'soft') {
							Extension.action.resetRemote(workspaceId, remoteName, branch).done(onDone).fail(onFail);
						}
					}).fail(function(err) {
						return Extension.resultData($result, null, err);
					});
					
					Popup.close($content);
					
					return false;
				}));
				$content.find('.actions').append(Popup.createBtn('Cancel', 'black'));
				
				Popup.open({
					title: 'Git - Pull from remote (' + remoteName + ')',
					content: $content,
					namespace: 'editor.git'
				});
			},
			push: function(workspaceId, remoteName, $remotesContent) {
				var data = Extension._data[workspaceId];
				if (!data) {
					return;
				}
				
				var remote = data.remotes.filter(function(remote) {
					return remote.name == remoteName;
				})[0];
				
				var $content = $('<div>\
					<div class="message">\
						<form autocomplete="false"><fieldset>\
							<dl>\
								<dt>Type</dt>\
								<dd>\
									<label for="git-input-default"><input type="radio" name="input-type" id="git-input-default" value="default" checked> Default push</label>\
									<label for="git-input-forced"><input type="radio" name="input-type" id="git-input-forced" value="forced"> Forced push</label>\
									<label for="git-input-delete"><input type="radio" name="input-type" id="git-input-delete" value="delete"> Delete remote branch</label>\
								</dd>\
							</dl>\
							<dl>\
								<dt>Branch</dt>\
								<dd><select name="input-branch"></select></dd>\
							</dl>\
						</fieldset></form>\
						<div class="error"></div>\
					</div>\
					<div class="actions"></div>\
				</div>');
				
				this.generateCredentialsInputs($content, remote);
				
				$content.find(':input[name="input-type"]').change(function() {
					if (!$(this).is(':checked')) {
						return false;
					}
					
					var isDelete = $(this).attr('value') == 'delete';
					
					$content.find(':input[name="input-branch"]').empty();
					
					data.branches.forEach(function(branch) {
						if ((isDelete && branch.remote != remoteName) || (!isDelete && branch.remote)) {
							return;
						}
						
						$content.find(':input[name="input-branch"]').append('<option value="' + branch.name.substr(branch.remote ? branch.remote.length+1 : 0) + '">' + branch.name + '</option>');
					});
				}).change();
				
				if ($content.find(':input[name="input-branch"] option[value="' + data.branch + '"]').length) {
					$content.find(':input[name="input-branch"]').val(data.branch);
				}
				
				$content.find('.actions').append(Popup.createBtn('Push', 'black', function() {
					var branch = $content.find(':input[name="input-branch"]').val();
					var type = $content.find(':input[name="input-type"]:checked').attr('value');
					
					var url = remote.url;
					var username = ($content.find(':input[name="input-username"]').val() || '').trim();
					var password = ($content.find(':input[name="input-password"]').val() || '').trim();
					var save = $content.find(':input[name="input-save"]').is(':checked');
					
					var urlData = Extension.parseUrl(url, username, password, save);
					
					if (!branch) {
						$content.find('.error').text('Please, select a branch.');
						return false;
					}
					
					var $result = Extension.onResult();
					
					Extension.remotes.pushWithSettings(workspaceId, remote, branch, type == 'forced', type == 'delete', urlData, $remotesContent).done(function(out) {
						Extension.resultData($result, out, null);
					}).fail(function(err) {
						Extension.resultData($result, null, err);
					});
					
					Popup.close($content);
					
					return false;
				}));
				$content.find('.actions').append(Popup.createBtn('Cancel', 'black'));
				
				Popup.open({
					title: 'Git - Push to remote (' + remoteName + ')',
					content: $content,
					namespace: 'editor.git'
				});
			},
			generateCredentialsInputs: function($content, remote) {
				if (/^https?:/.test(remote.url)) {
					$content.find('fieldset').append('<dl>\
						<dt>Username</dt>\
						<dd><input type="text" name="input-username" placeholder="Optional"></dd>\
					</dl>\
					<dl>\
						<dt>Password</dt>\
						<dd><input type="password" name="input-password" autocomplete="new-password" placeholder="Optional"></dd>\
					</dl>\
					<dl>\
						<dt></dt>\
						<dd><label for="git-input-save"><input type="checkbox" name="input-save" id="git-input-save"> Save credentials to remote url (in plain text)</label></dd>\
					</dl>');
					
					var auth = /:\/\/([^:]+):?([^@]*)@/.exec(remote.url);
					
					if (auth) {
						$content.find(':input[name="input-username"]').val(auth[1]);
						$content.find(':input[name="input-password"]').val(auth[2]);
						$content.find(':input[name="input-save"]').prop('checked', true);
					}
				}
			},
			fetchWithSettings: function(workspaceId, remote, urlData, $remotesContent) {
				var d = $.Deferred();
				
				var onRemoteUpdated = function(out) {
					Extension.action.fetchRemote(workspaceId, remote.name).done(function(out) {
						if (urlData.url != urlData.saveUrl) {
							Extension.action.setRemoteUrl(workspaceId, 'origin', urlData.saveUrl).done(function() {
								Extension.action.getRemotes(workspaceId).done(function(remotes) {
									Extension.remotes.list(workspaceId, $remotesContent, remotes);
								});
							});
						} else if (urlData.url != remote.url) {
							Extension.action.getRemotes(workspaceId).done(function(remotes) {
								Extension.remotes.list(workspaceId, $remotesContent, remotes);
							});
						}
						
						d.resolve(out);
					}).fail(function(err) {
						d.reject(err);
					});
				};
				
				if (remote.url != urlData.url) {
					Extension.action.setRemoteUrl(workspaceId, remote.name, urlData.url).done(function(out) {
						onRemoteUpdated(out)
					}).fail(function(err) {
						d.reject(err);
					});
				} else {
					onRemoteUpdated(null);
				}
				
				return d.promise();
			},
			pushWithSettings: function(workspaceId, remote, branch, forced, remove, urlData, $remotesContent) {
				var d = $.Deferred();
				
				var onRemoteUpdated = function(out) {
					Extension.action.pushRemote(workspaceId, remote.name, branch, forced, remove).done(function(out) {
						if (urlData.url != urlData.saveUrl) {
							Extension.action.setRemoteUrl(workspaceId, 'origin', urlData.saveUrl).done(function() {
								Extension.action.getRemotes(workspaceId).done(function(remotes) {
									Extension.remotes.list(workspaceId, $remotesContent, remotes);
								});
							});
						} else if (urlData.url != remote.url) {
							Extension.action.getRemotes(workspaceId).done(function(remotes) {
								Extension.remotes.list(workspaceId, $remotesContent, remotes);
							});
						}
						
						d.resolve(out);
					}).fail(function(err) {
						d.reject(err);
					});
				};
				
				if (remote.url != urlData.url) {
					Extension.action.setRemoteUrl(workspaceId, remote.name, urlData.url).done(function(out) {
						onRemoteUpdated(out);
					}).fail(function(err) {
						d.reject(err);
					});
				} else {
					onRemoteUpdated(null);
				}
				
				return d.promise();
			}
		},
		history: {
			parse: function(out) {
				var separator = "_._",
					newline = "_.nw._";
				
				out = out.substring(0, out.length - newline.length);
				return !out ? [] : out.split(newline).map(function(line) {

					var data = line.trim().split(separator),
						commit = {};

					commit.hashShort = data[0];
					commit.hash = data[1];
					commit.author = data[2];
					commit.date = new Date(data[3]);
					commit.email = data[4];
					commit.subject = data[5];
					commit.body = data[6];

					if (data[7]) {
						var tags = data[7];
						var regex = new RegExp("tag: ([^,|\)]+)", "g");
						tags = tags.match(regex);

						for (var key in tags) {
							if (tags[key] && tags[key].replace) {
								tags[key] = tags[key].replace("tag:", "");
							}
						}
						commit.tags = tags;
					}

					return commit;
				});
			},
			avatarStyle: function(author, email) {
				var seededRandom = function(max, min, seed) {
					max = max || 1;
					min = min || 0;

					seed = (seed * 9301 + 49297) % 233280;
					var rnd = seed / 233280.0;

					return min + rnd * (max - min);
				};

				// Use `seededRandom()` to generate a pseudo-random number [0-16] to pick a color from the list
				var seedBase = parseInt(author.charCodeAt(3).toString(), email.length),
					seed = parseInt(email.charCodeAt(seedBase.toString().substring(1, 2)).toString(), 16),
					colors = [
						"#ffb13b", "#dd5f7a", "#8dd43a", "#2f7e2f", "#4141b9", "#3dafea", "#7e3e3e", "#f2f26b",
						"#864ba3", "#ac8aef", "#f2f2ce", "#379d9d", "#ff6750", "#8691a2", "#d2fd8d", "#88eadf"
					],
					texts = [
						"#FEFEFE", "#FEFEFE", "#FEFEFE", "#FEFEFE", "#FEFEFE", "#FEFEFE", "#FEFEFE", "#333333",
						"#FEFEFE", "#FEFEFE", "#333333", "#FEFEFE", "#FEFEFE", "#FEFEFE", "#333333", "#333333"
					],
					picked = Math.floor(seededRandom(0, 16, seed));

				return "background-color: " + colors[picked] + "; color: " + texts[picked];
			},
			popup: function(workspaceId, file, out) {
				var data = Extension._data[workspaceId];
				if (!data) {
					return;
				}
				
				var history = this.parse(out);
				
				var $content = $('<div>\
					<div class="extension-git-list sscrollbar" style="height: 300px;">\
						<ul></ul>\
					</div>\
				</div>');
				
				this.list(workspaceId, $content, history);
				
				$content.find('.extension-git-list').scroll(function() {
					var top = $(this).scrollTop();
					
					if ($(this).attr('data-loaded')) {
						$(this).off('scroll');
						return true;
					}
					
					if ($(this).attr('data-loading')) {
						return true;
					}
					
					if (top + $(this).height() >= this.scrollHeight - 10) {
						$(this).attr('data-loading', true);
						
						Extension.action.getHistory(workspaceId, data.branch, $content.find('.extension-git-list > ul > li').length, file).done(function(out) {
							var history = Extension.history.parse(out);
							Extension.history.list(workspaceId, $content, history);
							$content.find('.extension-git-list').removeAttr('data-loading');
						});
					}
				});
				
				Popup.open({
					title: 'Git - History' + (file ? ' (' + file + ')' : ''),
					content: $content,
					namespace: 'editor.git'
				});
			},
			list: function(workspaceId, $content, history) {
				var $list = $content.find('.extension-git-list > ul');
				history.forEach(function(commit) {
					var date = Fn.sprintf('%02d', commit.date.getHours()) 
						+ ':' + Fn.sprintf('%02d', commit.date.getMinutes())
						+ ', ' + Fn.sprintf('%02d', commit.date.getMonth()+1)
						+ '/' + Fn.sprintf('%02d', commit.date.getDate())
						+ '/' + commit.date.getFullYear();
					
					$list.append('<li class="git-history">\
						<div class="inner">\
							<div class="col"><div class="git-avatar" style="' + Extension.history.avatarStyle(commit.author, commit.email) + '">' + (commit.author || commit.email).substr(0, 1).toUpperCase() + '</div></div>\
							<div class="col"><div class="info info-name">' + date + ' by <strong>' + (commit.author || commit.email) + '</strong></div></div>\
							<div class="col"><div class="info info-message">' + commit.subject + '</div></div>\
							<div class="col"><div class="info info-hash">' + commit.hashShort + '</div></div>\
						</div>\
					</div>');
				});
				
				if (history.length < 100) {
					$content.find('.extension-git-list').attr('data-loaded', true);
				}
			}
		},
		clone: {
			popup: function(workspaceId) {
			var data = Extension._data[workspaceId];
				if (!data) {
					return;
				}
				
				var $content = $('<div>\
					<div class="message">\
						<fieldset>\
							<dl>\
								<dt>Git URL</dt>\
								<dd><input type="text" name="input-url"></dd>\
							</dl>\
							<dl>\
								<dt>Username</dt>\
								<dd><input type="text" name="input-username" placeholder="Optional"></dd>\
							</dl>\
							<dl>\
								<dt>Password</dt>\
								<dd><input type="text" name="input-password" placeholder="Optional"></dd>\
							</dl>\
							<dl>\
								<dt></dt>\
								<dd><label for="git-input-save"><input type="checkbox" name="input-save" id="git-input-save"> Save credentials to remote url (in plain text)</label></dd>\
							</dl>\
						</fieldset>\
						<div class="error"></div>\
					</div>\
					<div class="actions"></div>\
				</div>');
				
				var $authInputs = $content.find(':input[name="input-username"],:input[name="input-password"],:input[name="input-save"]');
				
				$content.find(':input[name="input-url"]').on('input', function() {
					var val = $(this).val().trim();
					
					if (val) {
						if (/^https?:/.test(val)) {
							$authInputs.prop("disabled", false);
	
							// Update the auth fields if the URL contains auth
							var auth = /:\/\/([^:]+):?([^@]*)@/.exec(val);
							if (auth) {
								$content.find(':input[name="input-username"]').val(auth[1]);
								$content.find(':input[name="input-password"]').val(auth[2]);
							}
						} else {
							$authInputs.prop("disabled", true);
						}
					} else {
						$authInputs.prop("disabled", false);
					}
				});
				
				$content.find('.actions').append(Popup.createBtn('Clone', 'black', function() {
					var url = $content.find(':input[name="input-url"]').val().trim();
					var username = $content.find(':input[name="input-username"]').val().trim();
					var password = $content.find(':input[name="input-password"]').val().trim();
					var save = $content.find(':input[name="input-save"]').is(':checked');
					
					if (!url) {
						$content.find('.error').text('Please, fill a Git URL in.');
						return false;
					}
					
					var remote = Extension.parseUrl(url, username, password, save);
					
					var $result = Extension.onResult();
					
					Extension.action.clone(workspaceId, remote.url).done(function(out) {
						Popup.close($result);
						Explorer.action.list({id: workspaceId, path: '/'});
						
						Notification.open({
							type: 'success',
							title: 'Git',
							description: 'Repository was successfully cloned.',
							autoClose: true
						});
						
						Extension.action.status(workspaceId);
						
						if (remote.url != remote.saveUrl) {
							Extension.action.setRemoteUrl(workspaceId, 'origin', remote.saveUrl);
						}
					}).fail(function(err) {
						return Extension.resultData($result, null, err);
					});
					
					Popup.close($content);
					
					return false;
				}));
				$content.find('.actions').append(Popup.createBtn('Cancel', 'black'));
				
				Popup.open({
					title: 'Git - Clone',
					content: $content,
					namespace: 'editor.git'
				});
			}
		},
		parseUrl: function(url, username, password, save) {
			url = url.trim();
			url = url.replace(/^http(s?):\/\/(.*)\@(.*)$/, 'http$1://$3');
			var saveUrl = url;
			
			if (url.match(/^https?:/) && username) {
				url = url.replace(/^http(s?):\/\//, 'http$1://' + encodeURIComponent(username) + ':' + encodeURIComponent(password) + '@');
				
				if (save) {
					saveUrl = url;
				}
			}
			
			return {
				url: url,
				saveUrl: saveUrl,
				username: username,
				password: password
			};
		},
		onResult: function(out, err) {
			var $content = $('<div><pre class="extension-git-result"></pre></div>');
			
			$content.find('.extension-git-result').html((out || '') + (err || ''));
			
			Popup.open({
				title: 'Git - Result',
				content: $content,
				namespace: 'editor.git'
			});
			
			return $content;
		},
		resultData: function($result, out, err) {
			$result.find('.extension-git-result').html((out || '') + (err || ''));
		},
		callback: function() {
			var args = Array.prototype.slice.call(arguments);
			var fn = args.length ? args.shift() : null;
			
			if (typeof fn == 'function') {
				fn.apply(Extension, args);
			}
		},
		getAuthor: function() {
			var name = this.getStorage().name;
			var email = this.getStorage().email;
			
			return name && email ? name + ' <' + email + '>' : null;
		},
		action: {
			_run: function(workspaceId, commands) {
				var d = $.Deferred();
				
				commands = Array.isArray(commands) ? commands : [commands];
				
				Socket.send('workspace.action', {
					id: workspaceId,
					path: Extension._data[workspaceId].directory || '/',
					action: 'exec',
					command: commands.map(function(command) {
						return 'git ' + command;
					}).join('; ')
				}, null, function(data) {
					if (data.stderr) {
						d.reject(data.stderr);
					} else {
						d.resolve(data.stdout);
					}
				});
				
				return d.promise();
			},
			status: function(workspaceId, path) {
				var d = $.Deferred();
				var i;
				
				this._run(workspaceId, 'status -u -b --porcelain' + (path ? ' "' + path + '"' : '')).done(function(out) {
					var parsed = Extension.status.parse(out);
					
					var origFiles = parsed.files;
					
					if (path) {
						var files = Extension._data[workspaceId].files || [];
						
						for (i = files.length-1; i >= 0; i--) {
							var file = files[i].file;
							
							if (file == path || file.substr(0, path.length + 1) == path + '/') {
								files.splice(i, 1);
							}
						}
						
						files.push.apply(files, origFiles);
						parsed.files = files;
					}
					
					parsed.files.sort(function(a, b) {
						if (a.file < b.file) {
							return -1;
						}
						if (a.file > b.file) {
							return 1;
						}
						return 0;
					});
					
					if (parsed.needReset.length) {
						Extension.action.unstage(workspaceId, parsed.needReset).always(function() {
							Extension.action.status(workspaceId, path).done(function(data) {
								d.resolve(data);
							}).fail(function() {
								d.reject();
							});
						});
					} else {
						delete parsed.needReset;
						Extension.update(workspaceId, path ? {files: parsed.files} : parsed);
						d.resolve(path ? origFiles : parsed);
					}
				}).fail(function(err) {
					Extension.update(workspaceId, null);
					d.reject(err);
				});
				
				return d.promise();
			},
			init: function(workspaceId) {
				return this._run(workspaceId, 'init');
			},
			clone: function(workspaceId, url) {
				return this._run(workspaceId, 'clone ' + url + ' .');
			},
			stage: function(workspaceId, path) {
				path = Array.isArray(path) ? path : [path];
				
				path = path.map(function(item) {
					return '"' + Fn.quotes(item) + '"';
				}).join(' ');
				
				return this._run(workspaceId, 'add -A ' + path);
			},
			unstage: function(workspaceId, path) {
				path = Array.isArray(path) ? path : [path];
				
				path = path.map(function(item) {
					return '"' + Fn.quotes(item) + '"';
				}).join(' ');
				
				return this._run(workspaceId, 'reset -- ' + path);
			},
			commit: function(workspaceId, message, amend, cb) {
				var author = Extension.getAuthor();
				
				return this._run(workspaceId, 'commit -m "' + message.replace(/\"/, '\\\"') + '" ' + (amend ? '--amend' : '') + ' ' + (author ? '--author="' + author.replace(/\"/, '\\\"') + '"' : ''));
			},
			getLastCommitMessage: function(workspaceId, cb) {
				return this._run(workspaceId, 'log -1 --pretty=%B');
			},
			checkout: function(workspaceId, path, cb) {
				path = Array.isArray(path) ? path : [path];
				
				path = path.map(function(item) {
					return '"' + Fn.quotes(item) + '"';
				}).join(' ');
				
				return this._run(workspaceId, 'checkout ' + path);
			},
			getBranches: function(workspaceId, cb) {
				var d = $.Deferred();
				
				this._run(workspaceId, 'branch -a --no-color').done(function(out) {
					var current = null;
					var branches = (out || '').split("\n").reduce(function(arr, line) {
						var name = line.trim(),
							remote = null;

						if (!name || name.indexOf("->") !== -1) {
							return arr;
						}

						if (name.indexOf("* ") === 0) {
							name = name.substring(2);
							current = name;
						}

						if (name.indexOf("remotes/") === 0) {
							name = name.substring("remotes/".length);
							remote = name.substring(0, name.indexOf("/"));
						}

						arr.push({
							name: name,
							remote: remote
						});
						return arr;
					}, []);
					
					if (!branches.length) {
						branches.push({
							name: 'master',
							remote: null
						});
						
						current = 'master';
					}
					
					Extension.update(workspaceId, {
						branches: branches,
						branch: current
					});
					
					d.resolve(branches, current);
				}).fail(function(err) {
					Extension.update(workspaceId, {
						branches: [],
						branch: null
					});
					
					d.reject(err);
				});
				
				return d.promise();
			},
			createBranch: function(workspaceId, branch, origin, cb) {
				return this._run(workspaceId, 'checkout -b ' + branch + ' ' + (origin ? origin : ''));
			},
			deleteBranch: function(workspaceId, branch, force, cb) {
				return this._run(workspaceId, 'branch --no-color -' + (force ? 'D' : 'd') + ' ' + branch);
			},
			mergeBranch: function(workspaceId, branch, message, noFf, cb) {
				return this._run(workspaceId, 'merge ' + (noFf ? '--no-ff' : '') + ' ' + (message ? '-m "' +  message + '"' : '') + ' ' + branch);
			},
			rebaseBranch: function(workspaceId, branch, cb) {
				return this._run(workspaceId, 'rebase --ignore-date  ' + branch);
			},
			getRemotes: function(workspaceId, cb) {
				var d = $.Deferred();
				
				this._run(workspaceId, 'remote -v').done(function(out) {
					var remoteNames = [];
					var remotes =  !out ? [] : out.replace(/\((push|fetch)\)/g, "").split("\n").reduce(function(arr, line) {
						var s = line.trim().split("\t");
						
						if (!s[0] || remoteNames.indexOf(s[0]) !== -1) {
							return arr;
						}
						
						remoteNames.push(s[0]);
						
						arr.push({
							name: s[0],
							url: s[1]
						});
						return arr;
					}, []);
					
					remotes.sort(function(a, b) {
						if (a.name == 'origin') {
							return -1;
						} else if (b.name == 'origin') {
							return 1;
						} else {
							return a.name > b.name;
						}
					});
					
					Extension.update(workspaceId, {
						remotes: remotes
					});
					
					d.resolve(remotes);
				}).fail(function(err) {
					Extension.update(workspaceId, {
						remotes: []
					});
					
					d.reject(err);
				});
				
				return d.promise();
			},
			createRemote: function(workspaceId, name, url, cb) {
				return this._run(workspaceId, 'remote add ' + name + ' ' + url);
			},
			deleteRemote: function(workspaceId, name, cb) {
				return this._run(workspaceId, 'remote rm ' + name);
			},
			fetchRemote: function(workspaceId, name, cb) {
				return this._run(workspaceId, 'fetch ' + name);
			},
			mergeRemote: function(workspaceId, remote, branch, ffOnly, noCommit, cb) {
				return this._run(workspaceId, 'merge ' + (ffOnly ? '--ff-only' : '') + ' ' + (noCommit ? '--no-commit --no-ff' : '') + ' ' + remote + '/' + branch);
			},
			rebaseRemote: function(workspaceId, remote, branch, cb) {
				return this._run(workspaceId, 'rebase ' + remote + '/' + branch);
			},
			resetRemote: function(workspaceId, remote, branch, cb) {
				return this._run(workspaceId, 'reset --soft ' + remote + '/' + branch);
			},
			setRemoteUrl: function(workspaceId, remote, url, cb) {
				return this._run(workspaceId, 'remote set-url ' + remote + ' ' + url);
			},
			pushRemote: function(workspaceId, remote, branch, forced, remove, cb) {
				return this._run(workspaceId, 'push ' + remote + ' ' + branch + ' ' + (forced ? '--force' : '') + ' ' + (remove ? '--delete' : '') + ' --porcelain');
			},
			getHistory: function(workspaceId, branch, skipCount, file, cb) {
				var separator = "_._",
					newline = "_.nw._",
					format = [
						"%h", // abbreviated commit hash
						"%H", // commit hash
						"%an", // author name
						"%ai", // author date, ISO 8601 format
						"%ae", // author email
						"%s", // subject
						"%b", // body
						"%d" // tags
					].join(separator) + newline;
					
				return this._run(workspaceId, 'log -100 ' + (skipCount ? '--skip=' + skipCount : '' ) + ' --format=' + format + ' ' + branch + ' -- ' + (file ? file : ''));
			},
			diffFile: function(workspaceId, path) {
				var files = Extension._data[workspaceId].files;
				
				var isStaged = false;
				
				for (var i = 0; i < files.length; i++) {
					if (files[i].file == path) {
						isStaged = files[i].status.indexOf(FILE_STATUS.STAGED) !== -1;
						break;
					}
				}
				
				
				return this._run(workspaceId, 'diff --no-ext-diff --no-color' + (isStaged ? ' --staged' : '') + ' -- "' + path + '"');
			}
		}
	});

	module.exports = Extension;
});