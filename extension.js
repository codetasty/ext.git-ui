define(function(require, exports, module) {
	var ExtensionManager = require('code/extensionManager');
	
	var Code = require('code/code');
	var Socket = require('code/socket');
	var Workspace = require('code/workspace');
	var Notification = require('code/notification');
	var Fn = require('code/fn');
	var FileManager = require('code/fileManager');
	var Popup = require('code/popup');
	
	var Editor = require('modules/editor/editor');
	var Explorer = require('modules/explorer/explorer');
	var EditorSession;
	
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
			author: '',
		},
		css: [
			'extension'
		]
	}, {
		_data: {},
		init: function() {
			var self = this;
			
			EditorSession = require('modules/editor/ext/session');
			
			Editor.addToMenu('tools', {
				label: 'Git',
				isAvailable: function() {
					var id = Workspace.getStorage().active;
					
					return id && Workspace.isSsh(id);
				},
				observes: ['workspace', 'editor-git'],
				children: this.getMenuChildren.bind(this)
			});
			
			Workspace.on('connect', function(e) {
				self.onWorkspaceConnected(e.id);
			}).on('disconnect', function(e) {
				self.onWorkspaceDisconnected(e.id);
			});
		},
		getMenuChildren: function() {
			var workspaceId = Workspace.getStorage().active;
			var data = this._data[workspaceId];
			var items = [{
				label: 'Refresh status',
				exec: function() {
					Extension.action.status(workspaceId);
				}
			}, {
				label: 'Settings',
				spacer: true,
				exec: function() {
					Extension.settings.popup();
				}
			}];
			
			if (data && data.initialised) {
				items.push({
					label: 'Status',
					exec: function() {
						Extension.action.status(workspaceId, function() {
							Extension.status.popup(workspaceId);
						});
					}
				}, {
					label: 'Branch: <strong>' + data.branch + '</strong>',
					exec: function() {
						Extension.action.getBranches(workspaceId, function() {
							Extension.branches.popup(workspaceId);
						});
					}
				}, {
					label: 'Remotes',
					exec: function() {
						Extension.action.getRemotes(workspaceId, function() {
							Extension.remotes.popup(workspaceId);
						});
					}
				}, {
					label: 'History',
					exec: function() {
						Extension.action.getHistory(workspaceId, data.branch, null, null, function(out, err) {
							if (!err) {
								Extension.history.popup(workspaceId, null, out);
							} else {
								Extension.onResult(out, err);
							}
						});
					}
				}, {
					label: 'History for active file',
					isAvailable: function() {
						var file = EditorSession.getActive('file');
						
						return file && EditorSession.getStorage().sessions[file].workspaceId == workspaceId;
					},
					exec: function() {
						var session = EditorSession.getStorage().sessions[EditorSession.getActive('file')];
						
						if (!session) {
							return;
						}
						
						Extension.action.getHistory(workspaceId, data.branch, 0, session.path.substr(1), function(out, err) {
							if (!err) {
								Extension.history.popup(workspaceId, session.path.substr(1), out);
							} else {
								Extension.onResult(out, err);
							}
						});
					}
				});
			} else {
				items.push({
					label: 'Init',
					exec: function() {
						Extension.action.init(workspaceId, function(out, err) {
							if (!err) {
								Notification.open({
									type: 'success',
									title: 'Git',
									description: 'Repository was successfully created',
									autoClose: true
								});
							}
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
		onWorkspaceConnected: function(workspaceId) {
			this._data[workspaceId] = {
				initialised: false,
				branch: null,
				branches: [],
				remotes: [],
				files: []
			};
			
			this.action.status(workspaceId, function() {
				if (Workspace.getStorage().active == workspaceId) {
					Code.trigger('observe', {name: 'editor-git'});
				}
			});
		},
		onWorkspaceDisconnected: function(workspaceId) {
			delete this._data[workspaceId];
		},
		update: function(workspaceId, obj) {
			if (!this._data[workspaceId]) {
				return false;
			}
			
			if (obj === null) {
				this._data[workspaceId] = {
					initialised: false,
					branch: null,
					branches: [],
					remotes: [],
					files: []
				};
			} else {
				for (var i in obj) {
					this._data[workspaceId][i] = obj[i];
				}
			}
		},
		settings: {
			popup: function() {
				var $content = $('<div>\
					<div class="message">\
						<form autocomplete="false"><fieldset>\
							<dl>\
								<dt>Author</dt>\
								<dd><input type="text" name="input-author" placeholder="Full name &lt;email@domain.com&gt;">\
									<p>Optional, if empty, default setting will be used.</p>\
								</dd>\
							</dl>\
						</fieldset></form>\
						<div class="error"></div>\
					</div>\
					<div class="actions"></div>\
				</div>');
				
				$content.find(':input[name="input-author"]').val(Extension.getStorage().author);
				
				$content.find('.actions').append(Popup.createBtn('Save', 'black', function() {
					var author = $content.find(':input[name="input-author"]').val().trim();
					
					Extension.getStorage().author = author;
					Extension.saveStorage();
					
					Popup.close($content);
					
					return false;
				}));
				$content.find('.actions').append(Popup.createBtn('Cancel', 'black'));
				
				Popup.open({
					title: 'Git - Settings',
					content: $content,
					namespace: 'editor.git'
				});
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
				
				lines = lines.split("\n");
				var first = lines.shift().substr(2);
				var branch = first.trim().match(/^Initial commit on (\S+)/) || first.trim().match(/^([^\. ]+)/);
				if (branch) {
					status.branch = branch[1];
				}
				
				lines.forEach(function(line) {
					var statusStaged = line.substring(0, 1),
						statusUnstaged = line.substring(1, 2),
						fileStatus = [],
						file = line.substring(3);
					
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
				
				status.files.sort(function(a, b) {
					if (a.file < b.file) {
						return -1;
					}
					if (a.file > b.file) {
						return 1;
					}
					return 0;
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
					
					$file.find('.name .filename').html(file.name)
					.end().find('.name .status').text((file.status.map(function(status) {
						return FILE_STATUS_NAMES[status];
					}).join(', ')));
					
					if (file.status.indexOf(FILE_STATUS.STAGED) !== -1) {
						$file.addClass('selected');
					}
					
					$list.append($file);
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
					
					Extension.action[$li.hasClass('selected') ? 'stage' : 'unstage'](workspaceId, path, function() {
							Extension.status.update(workspaceId, $li);
					});
				}).end().find('.git-folder > .inner .name').click(function() {
					$(this).parents('.git-folder').eq(0).children('ul').stop().slideToggle(300);
				}).end().find('.git-folder').each(function() {
					if (!$(this).find('li.git-file:not(.selected)').length) {
						$(this).addClass('selected');
					} else {
						$(this).removeClass('selected');
					}
				});
				
				var $amend = $('<div class="extension-git-check"><span><i class="nc-icon-outline ui-1_check"></i></span> Amend last commit</div>').click(function() {
					$(this).toggleClass('checked');
					
					
					if ($(this).hasClass('checked')) {
						Extension.action.getLastCommitMessage(workspaceId, function(message) {
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
					
					Extension.action.commit(workspaceId, message, $amend.hasClass('checked'), function(out, err) {
						if (err) {
							return Extension.onResult(out, err);
						}
						
						Notification.open({
							type: 'success',
							title: 'Git',
							description: 'Updates were successfully commited',
							autoClose: true
						});
						
						if (openPush) {
							Extension.action.getRemotes(workspaceId, function() {
								Extension.remotes.popup(workspaceId);
							});
						}
					});
					Popup.close($content);
					
					return false;
				};
				
				$content.find('.actions').append(Popup.createBtn('Commit', 'black', function() {
					openPush = false;
					return commit();
				}));
				$content.find('.actions').append(Popup.createBtn('Commit and push', 'black', function() {
					openPush = true;
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
			update: function(workspaceId, $li) {
				var data = Extension._data[workspaceId];
				if (!data) {
					return;
				}
				
				var path = $li.hasClass('git-file') ? $li.attr('data-file') : $li.attr('data-folder') + '/';
				var mustBeEqual = $li.hasClass('git-file');
				var $parent = $li.parent();
				
				data.files.forEach(function(file) {
					if ((mustBeEqual && file.file != path) || (!mustBeEqual && file.file.substr(0, path.length) != path)) {
						return;
					}
					
					$parent.find('li.git-file[data-file="' + file.file + '"] .name .status').text((file.status.map(function(status) {
						return FILE_STATUS_NAMES[status];
					}).join(', ')));
				});
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
							<dl><dd class="full">\
								<select name="input-branch" placeholder="Branch name"></select>\
							</dd></dl>\
							<dl><dd class="full">\
								<input type="text" name="input-name" placeholder="Branch name">\
							</dd></dl>\
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
					
					Extension.action.createBranch(workspaceId, name, originBranch, function(created, branches, branch) {
						if (created) {
							Extension.branches.list(workspaceId, $content, branches, branch);
							
							$content.find(':input[name="input-name"]').val('');
						} else {
							Extension.onResult(null, branches);
						}
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
				
				$list.children().addClass('check').removeClass('selected');
				branches.forEach(function(branch) {
					if ($list.find('.git-item[data-name="' + branch.name + '"]').length) {
						$list.find('.git-item[data-name="' + branch.name + '"]').removeClass('check');
						return;
					}
					
					$select.append('<option value="' + branch.name + '">' + branch.name + '</option>');
					
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
					
					Extension.action.checkout(workspaceId, $item.find('.name').text(), function(out, err) {
						if (err) {
							return Extension.onResult(out, err);
						}
						
						$item.parent().children().removeClass('selected');
						$item.addClass('selected');
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
							Extension.action.deleteBranch(workspaceId, name, true, function(deleted, branches, branch) {
								if (deleted) {
									Extension.branches.list(workspaceId, $content, branches, branch);
								} else {
									Extension.onResult(null, branches);
								}
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
						Extension.action.rebaseBranch(workspaceId, branch, function(out, err) {
							$result.find('.extension-git-result').html((out || '') + (err || ''));
						});
					} else {
						Extension.action.mergeBranch(workspaceId, branch, message, noFf, function(out, err) {
							$result.find('.extension-git-result').html((out || '') + (err || ''));
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
							<dl><dd class="full">\
								<input type="text" name="input-name" placeholder="Name of the new remote">\
							</dd></dl>\
							<dl><dd class="full">\
								<input type="text" name="input-url" placeholder="URL of the new remote">\
							</dd></dl>\
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
					
					Extension.action.createRemote(workspaceId, name, url, function(created, remotes) {
						if (created) {
							Extension.remotes.list(workspaceId, $content, remotes);
							$content.find(':input[name="input-name"]').val('');
							$content.find(':input[name="input-url"]').val('');
						} else {
							Extension.onResult(null, remotes);
						}
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
					
					if (remote.name != 'origin') {
						$remote.find('.col').eq(2).append('<div class="action action-delete nc-icon-outline ui-1_simple-remove"></div>');
					}
					
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
							Extension.action.deleteRemote(workspaceId, name, function(deleted, remotes) {
								if (deleted) {
									Extension.remotes.list(workspaceId, $content, remotes);
								} else {
									Extension.onResult(null, remotes);
								}
							});
						}
					});
				}).end().find('.action-fetch').click(function() {
					var $item = $(this).parents('.git-item').eq(0);
					
					Extension.remotes.fetch(workspaceId, $item.attr('data-name'), $content);
				}).end().find('.action-pull').click(function() {
					var $item = $(this).parents('.git-item').eq(0);
					
					Extension.action.getBranches(workspaceId, function() {
						Extension.remotes.pull(workspaceId, $item.attr('data-name'), $content);
					});
				}).end().find('.action-push').click(function() {
					var $item = $(this).parents('.git-item').eq(0);
					
					Extension.action.getBranches(workspaceId, function() {
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
					
					Extension.action.fetchRemote(workspaceId, remoteName, function(out, err) {
						if (err) {
							return Extension.resultData($result, out, err);
						}
						
						Popup.close($result);
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
					
					Extension.remotes.fetchWithSettings(workspaceId, remote, urlData, $remotesContent, function(out, err) {
						if (err) {
							return Extension.resultData($result, out, err);
						}
						
						Popup.close($result);
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
									<label for="git-input-commit"><input type="radio" name="input-type" id="git-input-commit" value="commit"> Default merge</label>\
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
					
					var onMerge = function(out, err) {
						Extension.resultData($result, out, err);
						
						if (tracking) {
							Extension.action.checkout(workspaceId, branch);
						}
					};
					
					Extension.remotes.fetchWithSettings(workspaceId, remote, urlData, $remotesContent, function(out, err) {
						if (err) {
							return Extension.resultData($result, out, err);
						}
						
						if (['default', 'avoid', 'commit'].indexOf(type) !== -1) {
							Extension.action.mergeRemote(workspaceId, remoteName, branch, type == 'avoid', type == 'commit', onMerge);
						} else if (type == 'rebase') {
							Extension.action.rebaseRemote(workspaceId, remoteName, branch, onMerge);
						} else if (type == 'soft') {
							Extension.action.resetRemote(workspaceId, remoteName, branch, onMerge);
						}
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
					
					Extension.remotes.pushWithSettings(workspaceId, remote, branch, type == 'forced', type == 'delete', urlData, $remotesContent, function(out, err) {
						Extension.resultData($result, out, err);
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
			fetchWithSettings: function(workspaceId, remote, urlData, $remotesContent, cb) {
				var onRemoteUpdated = function(out, err) {
					if (err) {
						return cb(out, err);
					}
					
					Extension.action.fetchRemote(workspaceId, remote.name, function(out, err) {
						if (urlData.url != urlData.saveUrl) {
							Extension.action.setRemoteUrl(workspaceId, 'origin', urlData.saveUrl, function() {
								Extension.action.getRemotes(workspaceId, function(remotes) {
									Extension.remotes.list(workspaceId, $remotesContent, remotes);
								});
							});
						} else if (urlData.url != remote.url) {
							Extension.action.getRemotes(workspaceId, function(remotes) {
								Extension.remotes.list(workspaceId, $remotesContent, remotes);
							});
						}
						
						if (err) {
							return cb(out, err);
						}
						
						cb(out, err);
					});
				};
				
				if (remote.url != urlData.url) {
					Extension.action.setRemoteUrl(workspaceId, remote.name, urlData.url, onRemoteUpdated);
				} else {
					onRemoteUpdated(null, null);
				}
			},
			pushWithSettings: function(workspaceId, remote, branch, forced, remove, urlData, $remotesContent, cb) {
				var onRemoteUpdated = function(out, err) {
					if (err) {
						return cb(out, err);
					}
					
					Extension.action.pushRemote(workspaceId, remote.name, branch, forced, remove, function(out, err) {
						if (urlData.url != urlData.saveUrl) {
							Extension.action.setRemoteUrl(workspaceId, 'origin', urlData.saveUrl, function() {
								Extension.action.getRemotes(workspaceId, function(remotes) {
									Extension.remotes.list(workspaceId, $remotesContent, remotes);
								});
							});
						} else if (urlData.url != remote.url) {
							Extension.action.getRemotes(workspaceId, function(remotes) {
								Extension.remotes.list(workspaceId, $remotesContent, remotes);
							});
						}
						
						cb(out, err);
					});
				};
				
				if (remote.url != urlData.url) {
					Extension.action.setRemoteUrl(workspaceId, remote.name, urlData.url, onRemoteUpdated);
				} else {
					onRemoteUpdated(null, null);
				}
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
						
						Extension.action.getHistory(workspaceId, data.branch, $content.find('.extension-git-list > ul > li').length, file, function(out, err) {
							if (!err) {
								var history = Extension.history.parse(out);
								Extension.history.list(workspaceId, $content, history);
								$content.find('.extension-git-list').removeAttr('data-loading');
							}
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
					
					Extension.action.clone(workspaceId, remote.url, function(out, err) {
						if (err) {
							return Extension.resultData($result, out, err);
						}
						
						Popup.close($result);
						Explorer.action.list({id: workspaceId, path: '/'});
						Notification.open({
							type: 'success',
							title: 'Git',
							description: 'Repository was successfully cloned',
							autoClose: true
						});
						
						if (remote.url != remote.saveUrl) {
							Extension.action.setRemoteUrl(workspaceId, 'origin', remote.saveUrl);
						}
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
		action: {
			_run: function(workspaceId, commands, cb) {
				commands = Array.isArray(commands) ? commands : [commands];
				
				Socket.send('workspace.action', {
					id: workspaceId,
					path: '/',
					action: 'exec',
					command: commands.map(function(command) {
						return 'git ' + command;
					}).join('; ')
				}, null, function(data) {
					cb(data.stdout, data.stderr);
				});
			},
			status: function(workspaceId, cb) {
				this._run(workspaceId, 'status -u -b --porcelain', function(out, err) {
					if (err) {
						Extension.update(workspaceId, null);
						Extension.callback(cb);
						return false;
					}
					
					var parsed = Extension.status.parse(out);
					if (parsed.needReset.length) {
						Extension.action.unstage(workspaceId, parsed.needReset, cb);
					} else {
						delete parsed.needReset;
						Extension.update(workspaceId, parsed);
						Extension.callback(cb);
					}
				});
			},
			init: function(workspaceId, cb) {
				this._run(workspaceId, 'init', function(out, err) {
					if (err) {
						return Extension.callback(cb, out, err);
					}
					
					Extension.action.status(workspaceId, function() {
						Extension.callback(cb, out, err);
					});
				});
			},
			clone: function(workspaceId, url, cb) {
				this._run(workspaceId, 'clone ' + url + ' .', function(out, err) {
					if (err) {
						return Extension.callback(cb, out, err);
					}
					
					Extension.action.status(workspaceId, function() {
						Extension.callback(cb, out, err);
					});
				});
			},
			stage: function(workspaceId, path, cb) {
				this._run(workspaceId, 'add -A "' + path + '"', function(out) {
					Extension.action.status(workspaceId, function() {
						Extension.callback(cb);
					});
				});
			},
			unstage: function(workspaceId, path, cb) {
				this._run(workspaceId, Array.isArray(path) ? path.map(function(path) { return 'reset -- "' + path + '"'; }) : 'reset -- "' + path + '"', function(out) {
					Extension.action.status(workspaceId, function() {
						Extension.callback(cb);
					});
				});
			},
			commit: function(workspaceId, message, amend, cb) {
				var author = Extension.getStorage().author;
				
				this._run(workspaceId, 'commit -m "' + message.replace(/\"/, '\\\"') + '" ' + (amend ? '--amend' : '') + ' ' + (author ? '--author="' + author.replace(/\"/, '\\\"') + '"' : ''), function(out, err) {
					if (err) {
						return Extension.callback(cb, out, err);
					}
					
					Extension.action.status(workspaceId, function() {
						Extension.callback(cb, out, err);
					});
				});
			},
			getLastCommitMessage: function(workspaceId, cb) {
				this._run(workspaceId, 'log -1 --pretty=%B', function(out) {
					Extension.callback(cb, out || '');
				});
			},
			checkout: function(workspaceId, hash, cb) {
				this._run(workspaceId, 'checkout ' + hash, function(out, err) {
					Extension.action.status(workspaceId);
					Extension.callback(cb, out, err);
				});
			},
			getBranches: function(workspaceId, cb) {
				this._run(workspaceId, 'branch -a --no-color', function(out) {
					var current = null;
					var branches = out.split("\n").reduce(function(arr, line) {
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
					
					Extension.update(workspaceId, {
						branches: branches,
						branch: current
					});
					
					Extension.callback(cb, branches, current);
				});
			},
			createBranch: function(workspaceId, branch, origin, cb) {
				this._run(workspaceId, 'checkout -b ' + branch + ' ' + (origin ? origin : ''), function(out, err) {
					if (err) {
						return Extension.callback(cb, false, err);
					}
					
					Extension.action.getBranches(workspaceId, function(branches, branch) {
						Extension.callback(cb, true, branches, branch);
					});
				});
			},
			deleteBranch: function(workspaceId, branch, force, cb) {
				this._run(workspaceId, 'branch --no-color -' + (force ? 'D' : 'd') + ' ' + branch, function(out, err) {
					if (err) {
						return Extension.callback(cb, false, err);
					}
					
					Extension.action.getBranches(workspaceId, function(branches, branch) {
						Extension.callback(cb, true, branches, branch);
					});
				});
			},
			mergeBranch: function(workspaceId, branch, message, noFf, cb) {
				this._run(workspaceId, 'merge ' + (noFf ? '--no-ff' : '') + ' ' + (message ? '-m "' +  message + '"' : '') + ' ' + branch, function(out, err) {
					if (err) {
						return Extension.callback(cb, out, err);
					}
					
					Extension.action.status(workspaceId, function() {
						Extension.callback(cb, out, err);
					});
				});
			},
			rebaseBranch: function(workspaceId, branch, cb) {
				this._run(workspaceId, 'rebase --ignore-date  ' + branch, function(out, err) {
					if (err) {
						return Extension.callback(cb, out, err);
					}
					
					Extension.action.status(workspaceId, function() {
						Extension.callback(cb, out, err);
					});
				});
			},
			getRemotes: function(workspaceId, cb) {
				this._run(workspaceId, 'remote -v', function(out, err) {
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
					
					Extension.update(workspaceId, {
						remotes: remotes
					});
					
					Extension.callback(cb, remotes);
				});
			},
			createRemote: function(workspaceId, name, url, cb) {
				this._run(workspaceId, 'remote add ' + name + ' ' + url, function(out, err) {
					if (err) {
						return Extension.callback(cb, false, err);
					}
					
					Extension.action.getRemotes(workspaceId, function(remotes) {
						Extension.callback(cb, true, remotes);
					});
				});
			},
			deleteRemote: function(workspaceId, name, cb) {
				this._run(workspaceId, 'remote rm ' + name, function(out, err) {
					if (err) {
						return Extension.callback(cb, false, err);
					}
					
					Extension.action.getRemotes(workspaceId, function(remotes) {
						Extension.callback(cb, true, remotes);
					});
				});
			},
			fetchRemote: function(workspaceId, name, cb) {
				this._run(workspaceId, 'fetch ' + name, function(out, err) {
					if (err) {
						return Extension.callback(cb, out, err);
					}
					
					Extension.callback(cb, out, err);
				});
			},
			mergeRemote: function(workspaceId, remote, branch, ffOnly, noCommit, cb) {
				this._run(workspaceId, 'merge ' + (ffOnly ? '--ff-only' : '') + ' ' + (noCommit ? '--no-commit --no-ff' : '') + ' ' + remote + '/' + branch, function(out, err) {
					Extension.callback(cb, out, err);
				});
			},
			rebaseRemote: function(workspaceId, remote, branch, cb) {
				this._run(workspaceId, 'rebase ' + remote + '/' + branch, function(out, err) {
					Extension.callback(cb, out, err);
				});
			},
			resetRemote: function(workspaceId, remote, branch, cb) {
				this._run(workspaceId, 'reset --soft ' + remote + '/' + branch, function(out, err) {
					Extension.callback(cb, out, err);
				});
			},
			setRemoteUrl: function(workspaceId, remote, url, cb) {
				this._run(workspaceId, 'remote set-url ' + remote + ' ' + url, function(out, err) {
					Extension.callback(cb, out, err);
				});
			},
			pushRemote: function(workspaceId, remote, branch, forced, remove, cb) {
				this._run(workspaceId, 'push ' + remote + ' ' + branch + ' ' + (forced ? '--force' : '') + ' ' + (remove ? '--delete' : '') + ' --porcelain', function(out, err) {
					Extension.callback(cb, out, err);
				});
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

				this._run(workspaceId, 'log -100 ' + (skipCount ? '--skip=' + skipCount : '' ) + ' --format=' + format + ' ' + branch + ' -- ' + (file ? file : ''), function(out, err) {
					Extension.callback(cb, out, err);
				});
			}
		}
	});

	module.exports = Extension;
});