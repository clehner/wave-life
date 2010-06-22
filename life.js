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

(function () {

// Bresenham's line algorithm
function line(x0, x1, y0, y1, plot) {
	var steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
	var tmp;
	if (steep) {
		//swap(x0, y0)
		tmp = y0; y0 = x0; x0 = tmp;
		//swap(x1, y1)
		tmp = y1; y1 = x1; x1 = tmp;
	}
	if (x0 > x1) {
		//swap(x0, x1)
		tmp = x1; x1 = x0; x0 = tmp;
		//swap(y0, y1)
		tmp = y0; y0 = y1; y1 = tmp;    
	}
	var deltax = x1 - x0;
	var deltay = Math.abs(y1 - y0);
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
}

/* ----- Game Of Life ----- */

var container;
var canvas;
var ctx;
var tooltip;

var state;
var participants;
var viewer;
var participantsBySid = new SharedObject();

var rows = 0; // dimensions of the grid
var cols = 0;
var scale = 8; // size (px) of each cell
var ruleNumber = 2060; // ([2, 3], [3])

var cellsById = {};
var cells = []; // Array(Array(Cell))
var updatedCells = {}; // object
var gridState = []; // Array(Array(string))

var playing = false; // are we iterating
var dragAlive = true; // will dragging over a cell make it alive (or dead)

// Update the cells by one generation.
function iterate() {
	// Get the cells that were recently affected
	// (had a neighbor changed since the last iteration)
	// because they are the ones that may be updated this iteration.
	
	// Mark the neighbors of cells that were updated recently.
	// These "affected" cells are the only ones that might changed in this iteration.
	for (var i in updatedCells) {
		var updatedCell = updatedCells[i];
		var neighbors = updatedCell._neighbors || updatedCell.getNeighbors();
		for (var j = neighbors.length; j--;) {
			neighbors[j].affected = true;
		}
		updatedCell.affected = true;
	}

	// Update the affected cells and build the grid state string.
	var rowsNewState = []; // Array * string
	for (var y = rows; y--;) {
		var rowOldState = gridState[y];
		var rowNewState = [];
		var rowCells = cells[y];
		for (var x = cols; x--;) {
			var cell = rowCells[x];
			
			var cellState;
			if (cell.affected) {
				var willLive = cell.willLive();
				if (willLive != cell.alive) {
					// The cell is changing naturally (by the rules).
					// If the cell is becoming alive, it takes the owner of the
					// majority of its neighbors
					cellState = willLive ? getParticipantSid(
						cell.getInfluencingOwner()) : " ";
						
				} else if (cell.baseState != cell.overrideState) {
					// The cell has been changed by the user
					cellState = cell.alive ? getParticipantSid(cell.owner) : " ";
				
				} else {
					// default to old state if not updated
					cellState = rowOldState[x];
				}
				
				cell.affected = false;
				
			} else {
				cellState = rowOldState[x];
			}
			rowNewState[x] = cellState;
		}
		rowsNewState[y] = rowNewState.join("");
	}
	
	wavy.flushBuffer();
	
	// Assimilate the updated cells so they don't override the world any more.
	for (i in updatedCells) {
		updatedCell = updatedCells[i];
		if (updatedCell.overrideState != null) {
			updatedCell.setValue(null);
		}
	}
	
	updatedCells = {};
	
	state.set({
		"cells": null, // this is for the older version of the state.
		"cells2": rowsNewState.join("\n")
	});
	wavy.flushBuffer();
}

function updateGrid(gridStateString) {
	var newSidGrid, newSidRows, i, x, y,
		cellsRow, oldSidsRow, newSidsRow, sid, oldSid;
	
	// Decode the grid state
	newSidGrid = [];
	newSidRows = (gridStateString || "").split("\n");
	
	// Update the cells
	for (y = cells.length; y--;) {
		cellsRow = cells[y];
		oldSidsRow = gridState[y];
		newSidsRow = newSidGrid[y] = newSidRows[y] || "";
		
		for (x = cellsRow.length; x--;) {
			sid = newSidsRow[x];
			oldSid = oldSidsRow[x];
			if (sid !== oldSid) {
				if (sid == " ") {
					sid = null;
				}
				cellsRow[x].receiveBaseState(sid);
			}
		}
	}
	
	gridState = newSidGrid;
}

// process an older encoding of grid state
function updateGridOld(gridStateString) {
	var newSidGrid, newSidRows, i, x, y,
		cellsRow, oldSidsRow, newSidsRow, sid, oldSid, pid;
	
	// Decode the grid state
	newSidGrid = [];
	newSidRows = (gridStateString || "").split("\n");
	
	// Decode participant ids from the first line
	var pidsBySid = newSidRows.shift().split(",");
	var sidsByPid = {};
	for (i = pidsBySid.length; i--;) {
		sidsByPid[pidsBySid[i]] = "" + i;
	}
	
	// Update the cells
	for (y = cells.length; y--;) {
		cellsRow = cells[y];
		oldSidsRow = gridState[y];
		newSidsRow = newSidGrid[y] =
			(newSidRows[y] || "").split(",");
		
		for (x = cellsRow.length; x--;) {
			sid = newSidsRow[x];
			oldSid = oldSidsRow[x];
			if (sid !== oldSid) {
				pid = pidsBySid[sid];
				cellsRow[x].receiveBaseState(pid);
			}
		}
	}
	
	gridState = newSidGrid;
}

// maybe: debounce or throttle this
function drawAllCells() {
	for (var y = rows; y--;) {
		for (var x = cols; x--;) {
			cells[y][x].updateIcon();
		}
	}
}


// Participant sid encoding

participantsBySid.set({"\0":1, " ":1});

// get a short (compressed) id for a participant
function getParticipantSid(participant) {
	if (!participant) {
		return null;
	}
	var sid = participant.get("sid");
	if (sid == null) {
		// generate an new, unused sid
		do {
			sid = String.fromCharCode(Math.random() * 65536);
		} while (participantsBySid.get(sid));
		//participant.set("sid", sid);
		//participantsBySid.set(sid, participant);
		state.set(sid, participant.get("id"));
	}
	return sid;
}

function updateParticipantSid(participant, sid, prevParticipant) {
	if (prevParticipant) {
		prevParticipant.set("sid", null);
	}
	if (participant) {
		participant.set("sid", sid);
	}
	participantsBySid.set(sid, participant)
}

function getCellAtCoords(x, y) {
	return (cells[~~y] || {})[~~x];
}

function getMouseOffset(element, e) {
	// there's probably a better way to do this...
	var x = 0, y = 0;
	do {
		x += element.offsetLeft;
		y += element.offsetTop;
	} while (element = element.offsetParent);
	return {
		x: e.pageX - x,
		y: e.pageY - y
	};
}

// Get the (fractional) x and y cell coords under the cursor.
function getCoords(e) {
	var c = getMouseOffset(canvas, e);
	return {
		x: c.x / scale,
		y: c.y / scale
	};
}

function onMouseDown(e) {
	coords = getCoords(e);
	var cell = getCellAtCoords(coords.x, coords.y);
	if (!cell) {
		return;
	}
	
	window.addEventListener("mousemove", onMouseMove, false);
	window.addEventListener("mouseup", onMouseUp, false);	
	
	// If the cell is alive, kill cells. If it is dead, generate cells.
	dragAlive = !cell.alive;

	onMouseMove(e);
}

function onMouseMove(e) {
	// Update cells in a line from the old mouse location to here.
	
	var oldCoords = coords;
	coords = getCoords(e);
	
	var cellState = dragAlive && viewer;
	
	function hitCell(x, y) {
		var cell = getCellAtCoords(x, y);
		if (cell) {
			cell.setValue(cellState);
		}
	}
	
	wavy.buffer(function bufferedLine() {
		line(oldCoords.x, coords.x, oldCoords.y, coords.y, hitCell);
	});
	
	if (playing) {
		commitState();
	}
}

function onMouseUp(e) {
	window.removeEventListener("mousemove", onMouseMove, false);
	window.removeEventListener("mouseup", onMouseUp, false);	
	if (!playing) {
		commitState();
	}
}

// initialize cell grid
function initGrid(w, h, s) {
	cols = w;
	rows = h;
	canvas.width = cols * scale;
	canvas.height = rows * scale;
	gadgets.window.adjustHeight();
	scale = s;
	cells = Array(rows);
	gridState = Array(rows);
	for (var y = rows; y--;) {
		cells[y] = [];
		gridState[y] = [];
		for (var x = cols; x--;) {
			cells[y][x] = new Cell(x, y);
			gridState[y][x] = " ";
		}
	}
}

// Calculate a rule number from a S/B rule
// usage: makeRuleNumber("23/3") or ([2, 3], [3])
function makeRuleNumber(s, b) {
	if (arguments.length == 1) {
		var split = s.split("/");
		s = split[0];
		b = split[1];
	}
	
	var x = 0;
	for (var i = 0; i < s.length; i++) {
		x |= 1 << s[i];
	}
	for (var i = 0; i < b.length; i++) {
		x |= 256 << b[i];
	}
	return x;
}

/* ----- Tooltip ----- */

function hideTooltip() {
	tooltip.className = "";
}

function showTooltip(e) {
	// Move the tooltip to the mouse.
	var pos = getMouseOffset(container, e);
	var w = 270;
	var h = 34;
	var x = Math.max(0, Math.min(container.offsetWidth - w, pos.x - w/2));
	var y = Math.max(0, Math.min(container.offsetHeight - h, pos.y));
	tooltip.style.left = x + "px";
	tooltip.style.top = y + "px";
	tooltip.className = "visible";
	// When there is a mousedown outside the tooltip, hide it.
	document.addEventListener("mousedown", function onMouseDown() {
		hideTooltip();
		this.removeEventListener("mousedown", onMouseDown, true);
	}, true);
}

/* ----- Cell ----- */

function Cell(x, y) {
	this.id = x + "," + y;
	if (this.id in cellsById) {
		return cellsById[this.id];
	}
	cellsById[this.id] = this;
	this.x = ~~x;
	this.y = ~~y;
	//state.bind(this.id, this.receiveState, this);
}
Cell.prototype = {
	constructor: Cell,
	id: "",
	alive: false,
	aliveColor: "black",
	deadColor: "white",
	owner: /*:wave.Participant*/ null,
	baseState: "",
	overrideState: null,
	
	// Update the state for this particular cell.
	// It overrides the state given in the "cells2" key.
	receiveState: function receiveState(value /*:sid*/) {
		if (this.overrideState != value) {
			this.update(value == null ? this.baseState : value);
		}
		this.overrideState = value;
		if (value == this.baseState) {
			// Since the overriding cell state is the same as the base
			// state, the overriding state can be canceled.
			state.set(this.id, null);
		}
	},
	
	// Update the state for this cell, from the "cells2" key
	// It can be overridden by an individual state value for this cell.
	receiveBaseState: function receiveBaseState(value /*:sid*/) {
		if (this.overrideState == null) {
			if (value != this.baseState) {
				this.update(value);
			}
		} else {
			if (value == this.overrideState) {
				state.set(this.id, null);
			}
		}
		this.baseState = value || "";
	},
	
	// Set this cell's life or owner.
	setValue: function setValue(owner) {
		state.set(this.id, 
			owner ? getParticipantSid(owner) :
			owner == null ? null : "");
	},

	update: function update(sid /*:string*/) {
		updatedCells[this.id] = this;
		if (sid) {
			this.alive = true;
			if (sid.length > 1) {
				// In the old version, the pid was stored for each cell.
				var pid = sid;
				participants.bindOnce(pid, this.setOwner, this);
			} else {
				// In the new version, a sid is stored.
				participantsBySid.bindOnce(sid, this.setOwner, this);
			}
		} else {
			this.alive = false;
			this.owner = null;
			this.draw();
		}
	},
	
	setOwner: function setOwner(part) {
		this.owner = part;
		loadParticipantImage(part);
		//part.bindOnce("img", this.setIcon, this);
		this.updateIcon();
	},
	
	updateIcon: function updateIcon(icon) {
		this.icon = this.owner && this.owner.get("img");
		this.draw();
	},

	draw: function draw() {
		var size = scale;
		var x = this.x * size;
		var y = this.y * size;
		if (this.alive) {
			if (this.owner && this.icon) {
				ctx.drawImage(this.icon, x, y, size, size);
				return;
			} else {
				ctx.fillStyle = this.liveColor;
			}
		} else {
			ctx.fillStyle = this.deadColor;
		}
		ctx.fillRect(x, y, size, size);
	},
	
	// get the 8 neighboring cells
	getNeighbors /*:Array(8).Cell*/: function getNeighbors() {
		var grid, neighbors, w, h, x1, x2, x3, y1, y2, y3;
		
		grid = cells;
		w = cols;
		h = rows;
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
		rule = ruleNumber;
		return !!(this.alive ? (rule & 1<<n) : (rule & 256<<n));
	},
	
	// Get the owner value from the majority of the live neighboring cells,
	// or the viewer.
	getInfluencingOwner: function getInfluencingOwner() {
		var neighbors = this._neighbors || this.getNeighbors();
		var owners = {};
		for (var i = neighbors.length; i--;) {
			var cell = neighbors[i];
			if (cell.alive && cell.owner) {
				var pid = cell.owner.get("id");
				if (owners[pid]) {
					owners[pid]++;
				} else {
					owners[pid] = 1;
				}
			}
		}
		var max = 0;
		var owner;
		var ownerId;
		for (i in owners) {
			if (owners[i] > max) {
				max = owners[i];
				ownerId = i;
			}
		}
		if (max) {
			owner = participants.get(ownerId);
		}
		if (!owner) {
			owner = viewer;
		}
		return owner;
	},
	
	// Dragging over a cell and switching it on makes you its owner.
	draggedOver: function draggedOver(alive) {
		this.setValue(alive && viewer);
		if (playing) {
			commitState();
		}
	}
};

	
function playOrPause() {
	if (playing) {
		stop();
		playBtn.innerHTML = "Play";
	} else {
		play();
		playBtn.innerHTML = "Pause";
	}
}

function loadParticipantImage(part) {
	if (part._img) { return; }
	part.bind("thumbnailUrl", function (url) {
		var img = part._img = new Image();
		img.src = url;
		function onload() {
			part.set("img", img);
			// redraw cells when any participant thumbnail image changes.
			drawAllCells();
		}
		if (img.complete) {
			onload();
		} else {
			img.onload = onload;
		}
	});
}

// start the animation
function play() {
	wavy.buffer(function () {
		stop();
		playing = setInterval(iterate, 1000);
		iterate();
	}, this);
};

// stop animating
function stop() {
	if (playing) {
		clearInterval(playing);
		playing = false;
	}
}

function $(id) {
	return document.getElementById(id);
}
//World.prototype.ruleNumber = World.prototype.makeRuleNumber("1/1");

wavy.startBuffer();

var commitState = wavy.flushBuffer.throttled(250);

function onModeChange(mode, prevMode) {
	container.className = mode + "-mode";
	gadgets.window.adjustHeight();
	
	if (mode == "edit") {
		canvas.addEventListener("mousedown", onMouseDown, false);
	} else if (prevMode == "edit") {
		canvas.removeEventListener("mousedown", onMouseDown, false);
	}
	if (mode == "view") {
		canvas.addEventListener("click", showTooltip, false);
	} else if (prevMode == "view") {
		hideTooltip();
		canvas.removeEventListener("click", showTooltip, false);
	}
}

function connect() {
	window.addEventListener("blur", onMouseUp, false);
	canvas.addEventListener("contextmenu", onMouseUp, false);
	$("playBtn").addEventListener("click", playOrPause, false);
	$("nextBtn").addEventListener("click", iterate, false);
	
	wavy.bind("mode", onModeChange);
	
	// bind participant sids to state
	state.bind(function onKeyUpdate(key, value, prevValue) {
		if (key.length == 1) {
			// it's a sid
			participants.bindOnce(value, function (part) {
				updateParticipantSid(part, key, prevValue);
			});
		} else if (key == "cells" || key == "cells2") {
		} else {
			// it's a cell state
			var cell = cellsById[key];
			if (cell) {
				cell.receiveState(value);
			}
		}
	});
	
	state.bind("cells2", updateGrid);
	state.bind("cells", updateGridOld);

	state.bind("rule", function ruleChanged(value, prevValue) {
		ruleNumber = makeRuleNumber(value);
	});
}

window.init = function init() {
	container = $("container");
	canvas = $("canvas");
	ctx = canvas.getContext("2d");
	tooltip = $("tooltip");
	
	initGrid(60, 35, 8);

	wavy.bindOnce("participants", function (p) {
		participants = p;
		
		wavy.bindOnce("state", function (s) {
			state = s;
	
			wavy.bindOnce("viewer", function (v) {
				viewer = v;
				
				connect();
			});
		});
	});

	/*wavy.bind(["participants", "state", "viewer"], function (p, s, v) {
		participants = p;
		state = s;
		viewer = v;
		connect();
	});*/
	
	//state.bind("width", function 
	
}

})();