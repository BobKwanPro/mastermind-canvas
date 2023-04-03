"use strict";


/********
 * Statistics (counting and rendering)
 ********/
 
/*
targetSelector - JQuery selector for the container, in which the stats are rendered
maxRowNumber - if provided, all counts from 0 to maxRowNumber are initialized
*/
function MastermindStats(targetSelector, maxRowNumber){
	var that = this;
	
	this.targetSelector = targetSelector;
	this.maxRowNumber = (Number.isInteger(maxRowNumber) && maxRowNumber > 0) ? maxRowNumber : -1;
	this.skipEmptyRows = false;

	this.count_total = 0; // could be computed but... who cares ^^
	this.count_success = [];
	this.count_failure = [];
	
	var storageKey_prefix = window.location.pathname + "."; // whatever...


	this.set_skip_empty = function(flag) {
		this.skipEmptyRows = flag;
	};
	
	this.clear = function(){
		this.count_total = 0; 
		this.count_success = [];
		this.count_failure = [];
		localStorage.removeItem(storageKey_prefix + "MMStat_count_success");
		localStorage.removeItem(storageKey_prefix + "MMStat_count_failure");
		this.render();
	};
	
	this.inc_success = function(rowNumber){
		this.count_total++;
		if (typeof this.count_success[rowNumber] == "undefined"){
			this.count_success[rowNumber] = 0;
		}
		this.count_success[rowNumber]++;
		this.render();
		
		var stored_count_success = JSON.stringify(this.count_success);
		localStorage.setItem(storageKey_prefix + "MMStat_count_success", stored_count_success);
	};
	
	this.inc_failure = function(rowNumber){
		this.count_total++;
		if (typeof this.count_failure[rowNumber] == "undefined"){
			this.count_failure[rowNumber] = 0;
		}
		this.count_failure[rowNumber]++;
		this.render();
		
		var stored_count_failure = JSON.stringify(this.count_failure);
		localStorage.setItem(storageKey_prefix + "MMStat_count_failure", stored_count_failure);
	};
	
	this.render = function(){
		/* 1) compute ranges */
		var row_end = Math.max(this.count_success.length, this.count_failure.length) - 1;

		var row_start = -1;
		var max_total_per_row = 0;			
		for (var i=0; i<=row_end; i++){
			var total_per_row = 0;
			if (Number.isInteger(this.count_success[i]) || Number.isInteger(this.count_failure[i])){
				if (row_start < 0) row_start = i; // start at first defined value
				
				var c_s = this.count_success[i]>=0 ? this.count_success[i] : 0;
				var c_f = this.count_failure[i]>=0 ? this.count_failure[i] : 0;
				total_per_row = c_s + c_f;				
			} else {
				total_per_row = -1
			}
			
			max_total_per_row = Math.max(max_total_per_row, total_per_row);		
		}		
		//console.log ("range defined : " + row_start + " ~ " + row_end + " / max total : " + max_total_per_row);
		
		/* 2) Rendering */
		var htmlRows;
		if (row_end >= 0) {
			htmlRows = "";
			for (var i=row_start; i<=row_end; i++){
				/* 2.a) complementary calculations */
				// - Bar lengths are based on longest bar
				var w_success = Math.floor(100 * this.count_success[i] / max_total_per_row);
				var w_failure = Math.floor(100 * this.count_failure[i] / max_total_per_row);
				
				// - Cumulative success rates are based overall total
				var count_equal_or_better  = this.count_success.slice(0, i+1).reduce(
					(accumulator, currentValue) => accumulator + currentValue,
					0
				);
				var rate_success = Math.floor(100 * count_equal_or_better / this.count_total);
				
				
				/* 2.b) draw HTML */
				var htmlBar = "";				
				if (!Number.isNaN(w_success))
					htmlBar += `<div class="success" style="width:${w_success}%">${this.count_success[i]}</div>`;
				if (!Number.isNaN(w_failure))
					htmlBar += `<div class="failure" style="width:${w_failure}%">${this.count_failure[i]}</div>`;
				
				if (htmlBar || !this.skipEmptyRows){
					htmlRows += `<div class="row"><div class="row-tag">${i}<div class="tt">${rate_success}% equal or better</div></div><div class="row-bar">${htmlBar}</div></div>`;
				}
			}
			htmlRows += `<div class="row-text">${this.count_total} game${this.count_total>1?'s':''}  played.</div>`;
		} else {
			htmlRows = 'No game played yet.';
		}
		
		$(this.targetSelector).html(htmlRows);
	};
	
	
	/* ----- init ------ */
		
	if (this.maxRowNumber){ // init to 0 if "maxRowNumber" option has been set
		for (let i=0; i<=maxRowNumber; i++){
			this.count_success[i] = 0;
			this.count_failure[i] = 0;
		}
	}
	
	
	var stored_count_success = JSON.parse(localStorage.getItem(storageKey_prefix + "MMStat_count_success"));
	if (stored_count_success) {
		$.each(stored_count_success, function(key, value){
			if (!value) return;
			that.count_success[key] = value;
			that.count_total += value;
		});
	}
	var stored_count_failure = JSON.parse(localStorage.getItem(storageKey_prefix + "MMStat_count_failure"));
	if (stored_count_failure) {
		$.each(stored_count_failure, function(key, value){
			if (!value) return;
			that.count_failure[key] = value;
			that.count_total += value;
		});
	}		
	this.render();
}
	