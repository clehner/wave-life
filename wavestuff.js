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

waveStuff = new function () {
	var waveStuff = this;
	
	function Publisher() {
		var listeners = [];
		function publisher() {
			for (var i = 0, l = listeners.length; i < l; i++) {
				var listener = listeners[i];
				listener[0].apply(listener[1] || this, arguments);
			}
		}
		publisher.subscribe = function (fn, scope) {
			listeners[listeners.length] = [fn, scope];
			return this;
		};
		return publisher;
	}
	

	var waveState,
	    state = {}, 
	    participants = {},
	    buffer = {},
	    stateItems = {},
	    buffering = false,
	    stateLoaded = false,
	    participantsLoaded = false,
	    onNewKey = new Publisher(),
	    onParticipantUpdate = new Publisher(),
	    onLoad = new Publisher();

	function StateItem(key, onUpdate, onDelete, context) {
		// If a state item already exists for this key, add the callbacks to
		// it and return it instead of this.
		var stateItem = stateItems[key];
		if (stateItem) {
			if (stateItem != this) {
				arguments.callee.call(stateItem, arguments);
				return stateItem;
			}
		} else {
			stateItems[key] = this;
			this.key = key;
		}
		
		this.onUpdate = new Publisher()
			.subscribe(onUpdate, context);
		this.onDelete = new Publisher()
			.subscribe(onDelete, context);
		
		var value = state[key];
		if (value) {
			this.onUpdate(value);
		} else if (value === null) {
			this.onDelete(value);
		}
	}
	StateItem.prototype = {
		key: "",
		constructor: StateItem,
		onUpdate: /*Publisher*/ null,
		onDelete: /*Publisher*/ null,
		setValue: function (value) {
			if (buffering) {
				buffer[this.key] = value;
			} else {
				waveState.submitValue(this.key, value);
			}
		},
		detatch: function () {
			delete stateItems[key];
		}
	};
	
	function updateState(delta, a) {
		for (var key in delta) {
			var value = delta[key];
			if (state[key] !== value) {
				if (a) state[key] = value;
				if (!(key in stateItems)) {
					// new key
					onNewKey(key);
				}
				
				var stateItem = stateItems[key];
				if (stateItem) {
					if (value === null) {
						// delete key
						stateItem.onDelete();
						if (a) delete state[key];
					} else {
						// update key
						stateItem.onUpdate(value);
					}
				}
			}
		}
	}
	
	// called by wave
	function onStateChanged() {
		waveState = wave.state_;
		var newState = waveState.state_;
		
		if (!stateLoaded) {
			stateLoaded = true;
			if (participantsLoaded) {
				onLoad();
			}
		}
		
		// Check for deleted keys.
		for (var key in state) {
			if (!(key in newState)) {
				var stateItem = stateItems[key];
				if (stateItem) {
					stateItem.onDelete();
					delete state[key];
				}
			}
		}
		
		// Check for changed values.
		updateState(newState, true);
	}
	
	// called by wave
	function onParticipantChanged() {
		var newParticipants, id, newParticipant, oldParticipant, prop;
		
		if (!participantsLoaded) {
			participantsLoaded = true;
			if (stateLoaded) {
				onLoad();
			}
		}
		
		// This is a hack.
		newParticipants = wave.participantMap_;
		
		participantsSearch: for (id in newParticipants) {
			newParticipant = newParticipants[id];
			oldParticipant = participants[id];
			
			// check if the participant is new
			if (!oldParticipant) {
				onParticipantUpdate(newParticipant);
				continue participantsSearch;
			}
			// check for changed properties of the participant
			for (prop in newParticipant) {
				if (newParticipant[prop] != oldParticipant[prop]) {
					onParticipantUpdate(newParticipant);
					continue participantsSearch;
				}
			}
		}
		
		participants = newParticipants;
	}
	
	// called by gadget container
	function main() {
		if (window.wave && wave.isInWaveContainer()) {
			wave.setParticipantCallback(onParticipantChanged);
			wave.setStateCallback(onStateChanged);
		}
	}
	gadgets.util.registerOnLoadHandler(main);
	
	this.StateItem = StateItem;
	this._Publisher = Publisher;
	
	this.addLoadCallback = function (cb, context) {
		onLoad.subscribe(cb, context);
		if (stateLoaded && participantsLoaded) {
			cb.call(context);
		}
	};
	
	this.addParticipantUpdateCallback = onParticipantUpdate.subscribe;
	
	this.addNewKeyCallback = onNewKey.subscribe;
	
	this.startBuffer = function () {
		buffering = true;
	};
	
	this.endBuffer = function () {
		waveStuff.flushBuffer();
		buffering = false;
	};
	
	this.flushBuffer = function () {
		waveState.submitDelta(buffer);
		buffer = {};
	};
	
	// render the buffer locally, without sending it
	this.applyBuffer = function () {
		updateState(buffer, true);
	};
	
	this.buffer = function (fn, context) {
		var nestedBuffering = buffering;
		buffering = true;
		fn.call(context);
		if (!nestedBuffering) {
			waveStuff.flushBuffer();
		}
		buffering = nestedBuffering;
	};
};