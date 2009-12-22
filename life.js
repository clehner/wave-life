/*
 * Google Wave gadget for Conway's Game of Life.
 * 
 * Copyright (c) 2009 Charles Lehner
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

/* ----- Library functions ----- */

Function.prototype.bind = function (context) {
	var fn = this;
	return function bound() {
		return fn.apply(context, arguments);
	};
};

// for lazy function redefinition
Function.constant = function (c) {
	return function constant() {
		return c;
	};
};

// Make a function be called not more than once every @threshold ms.
Function.prototype.throttled = function throttlizer(threshold) {
	var func = this, throttling;
	function endThrottle() {
		throttling = false;
	}
	return function throttled() {
		if (!throttling) {
			throttling = true;
			setTimeout(endThrottle, threshold);
			return func.apply(this, arguments);
		}
	};
};

if (!Array.forEach) {
	Array.forEach = Array.prototype.forEach.call.bind(Array.prototype.forEach);
}

var Publisher = waveStuff._Publisher;

// Bresenham's line algorithm
var line = (function () {
	var abs = Math.abs;
	return function line(x0, x1, y0, y1, plot) {
		var steep = abs(y1 - y0) > abs(x1 - x0);
		var tmp;
		if (steep) {
			//swap(x0, y0)
			tmp = y0;
			y0 = x0;
			x0 = tmp;
			//swap(x1, y1)
			tmp = y1;
			y1 = x1;
			x1 = tmp;
		}
		if (x0 > x1) {
			//swap(x0, x1)
			tmp = x1;
			x1 = x0;
			x0 = tmp;
			//swap(y0, y1)
			tmp = y0;
			y0 = y1;
			y1 = tmp;    
		}
		var deltax = x1 - x0;
		var deltay = abs(y1 - y0);
		var error = deltax / 2;
		var y = y0;
		var ystep = (y0 < y1) ? 1 : -1;
		for (var x = x0; x <= x1; x++) {
			if (steep) {
				plot(y, x);
			} else {
				plot(x, y);
			}
			error -= deltay;
			if (error < 0) {
				y += ystep;
				error += deltax;
			}
		}
	};
})();

/* ----- ParticipantImage ----- */

var ParticipantImage = (function () {
	var images = {}; // by pid
	
	function addOnLoadListener(fn, scope) {
		this.onload.subscribe(fn, scope);
		if (this.complete) {
			fn.call(scope || this);
		}
	}
	
	return function ParticipantImage(participant) {
		var pid = participant.getId();
		var img = images[pid];
		if (!img) {
			img = images[pid] = new Image();
			img.src = participant.getThumbnailUrl();
			img.onload = new Publisher();
			img.addOnLoadListener = addOnLoadListener;
		}
		return img;
	};
})();

/* ----- Cell ----- */

function Cell(w, x, y) {
	this.world = w;
	this.x = ~~x;
	this.y = ~~y;
	this.id = x + "," + y;
	this.world.cellsById[this.id] = this;
	//this.render = this.render.bind(this);
	this.state = new waveStuff.StateItem(this.id, this.receiveState,
		this.removeState, this);
}
Cell.prototype = {
	constructor: Cell,
	id: "",
	world: /*:World*/ null,
	alive: false,
	aliveColor: "black",
	deadColor: "white",
	owner: /*:wave.Participant*/ null,
	baseState: undefined,
	overrideState: undefined,
	
	// Update the state for this particular cell.
	// It overrides the state given in the "cells" key.
	receiveState: function receiveState(state /*:string*/) {
		if (this.overrideState !== state) {
			this.update(state);
		}
		this.overrideState = state;
		if (state === (this.baseState || "")) {
			// Since the overriding cell state is the same as the base
			// state, the overriding state can be canceled.
			this.state.setValue(null);
		}
	},
	
	// Update the state for this cell, from the "cells" key
	// It can be overridden by an individual state value for this cell.
	receiveBaseState: function receiveBaseState(state /*:string*/) {
		if (this.overrideState === undefined) {
			if (state !== this.baseState) {
				this.update(state);
			}
		} else {
			if (state === this.overrideState) {
				debugger;
				this.state.setValue(null);
			}
		}
		this.baseState = state;
	},
	
	// the wave state for this cell has been removed.
	removeState: function () {
		if (this.overrideState !== this.baseState) {
			this.update(this.baseState);
		}
		this.overrideState = undefined;
	},
	
	// Set this cell's life or owner.
	setValue: function setValue(owner) {
		if (owner != this.owner && owner != this.alive) {
			this.state.setValue((owner === null) ?
				null : (owner ? owner.getId() : ""));
		}
	},

	update: function update(state /*:string*/) {
		this.world.updatedCells[this.id] = this;

		if (state) {
			this.alive = true;
			this.owner = wave.getParticipantById(state);
			
		} else {
			this.alive = false;
			this.owner = null;
		}
		this.renderOwner();
	},
	
	// get the 8 neighboring cells
	getNeighbors /*:Array(8).Cell*/: function getNeighbors() {
		var grid, neighbors, w, h, x1, x2, x3, y1, y2, y3;
		
		grid = this.world.cells;
		w = this.world.cols;
		h = this.world.rows;
		x2 = this.x;
		y2 = this.y;
		y1 = y2===0 ? h-1 : y2-1;
		x1 = x2===0 ? w-1 : x2-1;
		y3 = y2+1===h ? 0 : y2+1;
		x3 = x2+1===w ? 0 : x2+1;
		
		neighbors = [
			grid[y1][x2], // n
			grid[y1][x3], // ne
			grid[y2][x3], // e
			grid[y3][x3], // se
			grid[y3][x2], // s
			grid[y3][x1], // sw
			grid[y2][x1], // w
			grid[y1][x1]  // nw
		];
		
		// lazy function redefinition
		this.getNeighbors = Function.constant(neighbors);
		this._neighbors = neighbors;
		return neighbors;
	},
	
	// find whether or not this cell will be alive in the next generation
	willLive: function willLive() {
		var neighbors, n, rule;
		neighbors = this._neighbors || this.getNeighbors();
		n = (
			neighbors[0].alive + neighbors[1].alive +
			neighbors[2].alive + neighbors[3].alive +
			neighbors[4].alive + neighbors[5].alive +
			neighbors[6].alive + neighbors[7].alive
		);
		rule = this.world.ruleNumber;
		return !!(this.alive ? (rule & 1<<n) : (rule & 256<<n));
	},
	
	// Get the owner value from the majority of the live neighboring cells,
	// or the viewer.
	getInfluencingOwner: function getInfluencingOwner() {
		var neighbors, owners, max, owner, i, ownerId, cell;
		
		neighbors = this._neighbors || this.getNeighbors();
		owners = {};
		for (i = neighbors.length; i--;) {
			cell = neighbors[i];
			if (cell.alive && cell.owner) {
				var pid = cell.owner.getId();
				if (owners[pid]) {
					owners[pid]++;
				} else {
					owners[pid] = 1;
				}
			}
		}
		max = 0;
		owner = wave.getViewer();
		for (i in owners) {
			if (owners[i] > max) {
				max = owners[i];
				ownerId = i;
			}
		}
		if (max) {
			owner = wave.getParticipantById(ownerId);
		}
		if (!owner) {
			owner = wave.getViewer();
		}
		return owner;
	},
	
	// Dragging over a cell and switching it on makes you its owner.
	draggedOver: function draggedOver(alive) {
		this.setValue(alive && wave.getViewer());
		if (this.world.playing) {
			commitState();
		} else {
			renderState();
			//waveStuff.applyDeltas();
		}
	},
	
	renderOwner: function renderOwner() {
		if (this.owner) {
			this.icon = new ParticipantImage(this.owner);
			this.icon.addOnLoadListener(this.render, this);
		} else {
			this.render();
		}
	},

	render: function render() {
		var x, y, size, ctx;
		ctx = this.world.ctx;
		size = this.world.scale;
		x = this.x * size;
		y = this.y * size;
		if (this.alive) {
			if (this.owner && this.icon) {
				ctx.drawImage(this.icon, x, y, size, size);
			} else {
				ctx.fillStyle = this.liveColor;
				ctx.fillRect(x, y, size, size);
			}
		} else {
			ctx.fillStyle = this.deadColor;
			ctx.fillRect(x, y, size, size);
		}
	}
};

/* ----- World ----- */

function World(canvas) {
	this.canvas = canvas;
	this.ctx = canvas.getContext("2d");
	this.renderSize();
	
	this.bindMethods("onMouseDown", "onMouseMove", "onMouseUp",
		"onContextMenu", "iterate");
	
	addEventListener("blur", this.onMouseUp, false);
	this.canvas.addEventListener("mousedown", this.onMouseDown, false);
	this.canvas.addEventListener("contextmenu", this.onContextMenu, false);
	
	this.pidsBySid = [];
	this.sidsByPid = {};

	this.initGrid();
	
	this.state = new waveStuff.StateItem("cells", this.updateGrid, null, this);
}
World.prototype = {
	constructor: World,
	
	canvas /*:HTMLCanvasObject*/: null, 
	ctx /*:CanvasRenderingContext2D*/: null,
	
	rows: 35, // dimensions of the grid
	cols: 60,
	scale: 8, // size (px) of each cell
	ruleNumber: 2060, // ([2, 3], [3])
	
	cells /*:Array(Array(Cell))*/: null,
	updatedCells /*:Object*/: null,
	cellsById /*:Object*/: null,
	gridState /*:Array(Array(string))*/: null,
	
	pidsBySid /*Array(string)*/: null,
	sidsByPid /*Object*/: null,

	dragAlive: true, // will dragging over a cell make it alive (or dead)

	// bind methods to this instance.
	bindMethods: function () {
		var methods = arguments;
		for (var i = methods.length; i--;) {
			var methodName = methods[i];
			this[methodName] = this[methodName].bind(this);
		}
	},
	
	// initialize cell grid
	initGrid: function () {
		var x, y, row, row2;
		this.updatedCells = {};
		this.cellsById = {};
		this.cells = Array(this.rows);
		this.gridState = Array(this.rows);
		for (y = this.rows; y--;) {
			row = this.cells[y] = [];
			row2 = this.gridState[y] = [];
			for (x = this.cols; x--;) {
				row[x] = new Cell(this, x, y);
				row2[x] = "";
			}
		}
	},
	
	// Update the cells by one generation.
	iterate: function iterate() {
		var updatedCells, i, updatedCell, willLive, cell,
		    neighbors, j, x, y, gridState, pidsCompressed,
		    rowsNewState, rowNewState, rowOldState, rowCells, state;
		
		// Get the cells that were recently affected
		// (had a neighbor changed since the last iteration)
		// because they are the ones that may be updated this iteration.
		
		// Mark the neighbors of cells that were updated recently.
		// These "affected" cells are the only ones that might changed in this iteration.
		updatedCells = this.updatedCells;
		this.updatedCells = {};
		for (i in updatedCells) {
			updatedCell = updatedCells[i];
			neighbors = updatedCell._neighbors || updatedCell.getNeighbors();
			for (j = neighbors.length; j--;) {
				neighbors[j].affected = true;
			}
			updatedCell.affected = true;
		}
	
		// Update the affected cells and build the grid state string.
		rowsNewState = []; // Array * string
		for (y = this.rows; y--;) {
			rowOldState = this.gridState[y];
			rowNewState = [];
			rowCells = this.cells[y];
			for (x = this.cols; x--;) {
				cell = rowCells[x];
				
				if (cell.affected) {
					willLive = cell.willLive();
					if (willLive != cell.alive) {
						// The cell is changing naturally (by the rules).
						// If the cell is becoming alive, it takes the owner of the
						// majority of its neighbors
						state = willLive ? this.getParticipantSid(
							cell.getInfluencingOwner()) : "";
							
					} else if (cell.baseState != cell.overrideState) {
						// The cell has been changed by the user
						state = cell.alive ? this.getParticipantSid(cell.owner) : "";
					
					} else {
						// default to old state if not updated
						state = rowOldState[x];
					}
					
					cell.affected = false;
					
				} else {
					state = rowOldState[x];
				}
				rowNewState[x] = state;
			}
			rowsNewState[y] = rowNewState.join(",");
		}
		
		// Assimilate the updated cells so they don't override the world any more.
		for (i in updatedCells) {
			updatedCell = updatedCells[i];
			if (updatedCell.overrideState !== undefined) {
				updatedCell.state.setValue(null);
			}
		}
		
		// Compress the grid state by encoding participant ids as short ids.
		pidsCompressed = this.pidsBySid.join(",");
		
		// Combine cell states with pids
		rowsNewState.unshift(pidsCompressed);
		gridState = rowsNewState.join("\n");
		
		this.state.setValue(gridState);
		waveStuff.flushBuffer();
	},
	
	updateGrid: function updateGrid(gridState) {
		var newSidGrid, cellsGrid, newSidRows, i, x, y,
			cellsRow, oldSidsRow, newSidsRow, sid, oldSid, pid;
		
		// Decode the grid state
		newSidGrid = [];
		cellsGrid = this.cells;
		newSidRows = gridState.split("\n");
		
		// Decode participant ids from the first line
		this.pidsBySid = newSidRows.shift().split(",");
		for (i = this.pidsBySid.length; i--;) {
			this.sidsByPid[this.pidsBySid[i]] = i;
		}
		
		// Update the cells
		for (y = cellsGrid.length; y--;) {
			cellsRow = cellsGrid[y];
			oldSidsRow = this.gridState[y];
			newSidsRow = newSidGrid[y] =
				(newSidRows[y] || "").split(",");
			
			for (x = cellsRow.length; x--;) {
				sid = newSidsRow[x];
				oldSid = oldSidsRow[x];
				if (sid !== oldSid) {
					pid = this.pidsBySid[sid];
					cellsRow[x].receiveBaseState(pid);
				}
			}
		}
		
		this.gridState = newSidGrid;
	},
	
	// get a short (compressed) id for a participant
	getParticipantSid: function getParticipantSid(participant) {
		if (!participant) {
			return "";
		}
		var sidsByPid = this.sidsByPid;
		var pidsBySid = this.pidsBySid;
		
		var pid = participant.getId();
		if (pid in sidsByPid) {
			return sidsByPid[pid];
		}
		var sid = pidsBySid.length;
		pidsBySid[sid] = pid;
		sidsByPid[pid] = sid;
		return sid;
	},
	
	// Calculate a rule number from a S/B rule
	// usage: makeRuleNumber("23/3") or ([2, 3], [3])
	makeRuleNumber: function (s, b) {
		if (arguments.length == 1) {
			var split = s.split("/");
			s = split[0];
			b = split[1];
		}
		
		var x = 0;
		Array.forEach(s, function (n) {
			x |= 1<<n;
		});
		Array.forEach(b, function (n) {
			x |= 256<<n;
		});
		return x;
	},
	
	getCellAtCoords: function getCellAtCoords(x, y) {
		return (this.cells[~~y] || [])[~~x];
	},
	
	// Get the (fractional) x and y coords under the cursor.
	getCoords: function getCoords(e) {
	
		// Add the offsetX and offsetY values to e
		function fixOffset(e) {
			var obj, oX, oY;
			if ("offsetX" in e) {
				return;
			}
			obj = e.target;
			
			// find the absolute position of the object
			oX = oY = 0;
			do {
				oX += obj.offsetLeft;
				oY += obj.offsetTop;
			} while ((obj = obj.offsetParent));
			
			// return the relative position
			e.offsetX = e.pageX - oX;
			e.offsetY = e.pageY - oY;
		}
		
		fixOffset(e);
		
		return {
			x: e.offsetX / this.scale,
			y: e.offsetY / this.scale
		};
	},
	
	onMouseDown: function (e) {
		this.coords = this.getCoords(e);
		var cell = this.getCellAtCoords(this.coords.x, this.coords.y);
		if (!cell) {
			return;
		}
		
		addEventListener("mousemove", this.onMouseMove, false);
		addEventListener("mouseup", this.onMouseUp, false);	
		
		// If the cell is alive, kill cells. If it is dead, generate cells.
		this.dragAlive = !cell.alive;

		this.onMouseMove(e);
	},
	
	onMouseMove: function (e) {
		// Update cells in a line from the old mouse location to here.
		
		var $this = this;
		var coords = this.getCoords(e);
		var oldCoords = this.coords;
		this.coords = coords;
		
		var cellState = this.dragAlive && wave.getViewer();
		
		function hitCell(x, y) {
			var cell = $this.getCellAtCoords(x, y);
			if (cell) {
				cell.setValue(cellState);
			}
		}
		
		waveStuff.buffer(function bufferedLine() {
			line(oldCoords.x, coords.x, oldCoords.y, coords.y, hitCell);
		});
		
		if (this.playing) {
			commitState();
		} else {
			renderState();
			//waveStuff.applyDeltas();
		}
	},
	
	onMouseUp: function (e) {
		removeEventListener("mousemove", this.onMouseMove, false);
		removeEventListener("mouseup", this.onMouseUp, false);	
		if (!this.playing) {
			commitState();
		}
	},
	
	onContextMenu: function (e) {
		this.onMouseUp(e);
	},
	
	renderSize: function () {
		this.canvas.width = this.cols * this.scale;
		this.canvas.height = this.rows * this.scale;
	},
	
	// start the animation
	play: function () {
		this.stop();
		this.playing = setInterval(this.iterate, 1000);
		this.iterate();
	},
	
	// stop animating
	stop: function () {
		if (this.playing) {
			clearInterval(this.playing);
			this.playing = false;
		}
	}
};
//World.prototype.ruleNumber = World.prototype.makeRuleNumber("1/1");

var renderState = waveStuff.applyBuffer;

waveStuff.startBuffer();

var commitState = (function () {
	var flushBufferThrottled = waveStuff.flushBuffer.throttled(250);
	return function () {
		flushBufferThrottled();
		renderState();
	};
})();

waveStuff.addParticipantUpdateCallback(function (participant) {
	(new ParticipantImage(participant)).src = participant.getThumbnailUrl();
});