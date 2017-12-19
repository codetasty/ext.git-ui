/* global define, $ */
"use strict";

define(function(require, exports, module) {
	// libs
	const CollectionCluster = require('collection-cluster');
	
	/**
	 * Folder
	 */
	class Folder extends CollectionCluster.Cell {
		constructor(tagName) {
			super(tagName);
			
			this.delegate = null;
			
			this.el.classList.add('item');
			
			this.name = document.createElement('div');
			this.name.classList.add('name');
			
			this.icon = document.createElement('div');
			this.icon.classList.add('icon', 'nc-icon-glyph', 'files_folder-15');
			this.name.appendChild(this.icon);
			
			this.nameSpan = document.createElement('span');
			this.name.appendChild(this.nameSpan);
			
			this.el.appendChild(this.name);
		}
		
		update(item) {
			this.item = item;
			
			this.el.style.paddingLeft = (item.level * 15) + 'px';
			this.nameSpan.textContent = item.name;
		}
	}
	
	Folder.identifier = 'folder';
	
	exports.Folder = Folder;
	
	/**
	 * File
	 */
	class File extends CollectionCluster.Cell {
		constructor(tagName) {
			super(tagName);
			
			this.delegate = null;
			
			this.el.classList.add('item');
			
			this.name = document.createElement('div');
			this.name.classList.add('name', 'adjusted');
			
			this.checkbox = document.createElement('div');
			this.checkbox.classList.add('checkbox');
			this.name.appendChild(this.checkbox);
			
			this.spinner = document.createElement('div');
			this.spinner.classList.add('spinner');
			this.name.appendChild(this.spinner);
			
			this.nameSpan = document.createElement('span');
			this.name.appendChild(this.nameSpan);
			
			this.el.appendChild(this.name);
			
			this.discard = document.createElement('button');
			this.discard.classList.add('nc-icon-glyph', 'ui-1_simple-remove');
			this.el.appendChild(this.discard);
			
			this.onClick = this.onClick.bind(this);
			
			this.el.addEventListener('click', this.onClick);
		}
		
		update(item) {
			this.item = item;
			
			this.el.style.paddingLeft = (item.level * 15) + 'px';
			this.nameSpan.textContent = item.name;
			this.updateState();
		}
		
		updateState() {
			this.el.classList[this.item.isStaged ? 'add' : 'remove']('checked');
			this.el.classList[this.item.isLoading ? 'add' : 'remove']('loading');
			this.spinner.classList[this.item.isLoading ? 'add' : 'remove']('active');
			
			this.discard.style.display = this.item.isUndo ? 'block' : 'none';
		}
		
		onClick(e) {
			if (e.target === this.checkbox) {
				this.delegate.onFileCheck(this);
			} else if (e.target === this.nameSpan || e.target === this.name) {
				this.delegate.onFileDiff(this);
			}	else if (e.target === this.discard) {
				this.delegate.onFileDiscard(this);
			}
		}
	}
	
	File.identifier = 'file';
	
	exports.File = File;
	
	/**
	 * Branch
	 */
	class Branch extends CollectionCluster.Cell {
		constructor(tagName) {
			super(tagName);
			
			this.delegate = null;
			
			this.el.classList.add('item');
			
			this.name = document.createElement('div');
			this.name.classList.add('name');
			
			this.spinner = document.createElement('div');
			this.spinner.classList.add('spinner');
			this.name.appendChild(this.spinner);
			
			this.nameSpan = document.createElement('span');
			this.name.appendChild(this.nameSpan);
			
			this.el.appendChild(this.name);
			
			this.merge = document.createElement('button');
			this.merge.classList.add('devicons', 'devicons-git_merge');
			this.el.appendChild(this.merge);
			
			this.delete = document.createElement('button');
			this.delete.classList.add('nc-icon-glyph', 'ui-1_simple-remove');
			this.el.appendChild(this.delete);
			
			this.onClick = this.onClick.bind(this);
			
			this.el.addEventListener('click', this.onClick);
		}
		
		update(item) {
			this.item = item;
			
			this.nameSpan.textContent = item.name;
			this.updateState();
		}
		
		updateState() {
			this.el.classList[this.item.isCurrent ? 'add' : 'remove']('selected');
			this.el.classList[this.item.isLoading ? 'add' : 'remove']('loading');
			this.spinner.classList[this.item.isLoading ? 'add' : 'remove']('active');
			
			this.merge.style.display = this.item.isCurrent ? 'none' : 'block';
			this.delete.style.display = this.item.isCurrent || this.item.isMaster ? 'none' : 'block';
		}
		
		onClick(e) {
			if (e.target === this.name || e.target === this.nameSpan) {
				this.delegate.onBranchSelect(this);
			} else if (e.target === this.merge) {
				this.delegate.onBranchMerge(this);
			} else if (e.target === this.delete) {
				this.delegate.onBranchDelete(this, e.shiftKey);
			}
		}
	}
	
	Branch.identifier = 'branch';
	
	exports.Branch = Branch;
	
	/**
	 * Remote
	 */
	class Remote extends CollectionCluster.Cell {
		constructor(tagName) {
			super(tagName);
			
			this.delegate = null;
			
			this.el.classList.add('item');
			
			this.name = document.createElement('div');
			this.name.classList.add('name');
			
			this.spinner = document.createElement('div');
			this.spinner.classList.add('spinner');
			this.name.appendChild(this.spinner);
			
			this.nameSpan = document.createElement('span');
			this.name.appendChild(this.nameSpan);
			
			this.el.appendChild(this.name);
			
			this.delete = document.createElement('button');
			this.delete.classList.add('nc-icon-glyph', 'ui-1_simple-remove');
			this.el.appendChild(this.delete);
			
			this.onClick = this.onClick.bind(this);
			
			this.el.addEventListener('click', this.onClick);
		}
		
		update(item) {
			this.item = item;
			
			this.nameSpan.textContent = item.name;
			this.updateState();
		}
		
		updateState() {
			this.el.classList[this.item.isSelected ? 'add' : 'remove']('selected');
			this.el.classList[this.item.isLoading ? 'add' : 'remove']('loading');
			this.spinner.classList[this.item.isLoading ? 'add' : 'remove']('active');
		}
		
		onClick(e) {
			if (e.target === this.name || e.target === this.nameSpan) {
				this.delegate.onRemoteSelect(this);
			} else if (e.target === this.delete) {
				this.delegate.onRemoteDelete(this, e.shiftKey);
			}
		}
	}
	
	Remote.identifier = 'remote';
	
	exports.Remote = Remote;
});