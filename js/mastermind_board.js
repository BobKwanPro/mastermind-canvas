"use strict";

//TODO meilleur style OOP à la JS (that = this et/ou autres bouffonneries) ; pour permettre le multi-instances
//TODO remplacer les .on() en direct par des "Delegated event handlers" mutualisés
//TODO ajouter + de hooks et de parametres pour les onSelectColor, onSelectPosition, etc. pour les animations et bruitages
//TODO ajouter paramètres de hook pour voir la réussite des onSelect, avec distinction sur l'effet (du double select, notamment)
// TODO document params de hooks, y compris le data("codeType")


var MastermindBoard = {
	/* default, to be overridden */
	settings : {
		selectionScheme : "COLOR_FIRST", // among "COLOR_FIRST", "POSITION_FIRST", "DRAG", "MATRIX"
		//TODO implement selectionScheme : "DRAG" et "MATRIX"
		doubleSelectionEffect : "EMPTY", // among "NONE", "EMPTY", "LOCK"
		reverseGuessStack : true, // note: could be replaced with CSS flex-flow: column-reverse, but as of March 2020, Firefox still has a problem with this and overflow-y: scroll
		autoCommit : false, // note: beware of LOCK + autoCommit...
		maxRowNumber : 20, // max number of tries ; set to "undefined" for unlimited guesses
		//TODO autoSelectEmptyPosition ? conflict with Drag N Drop ?

		selectionEffect : "REPLACE_ELEMENT", // among "REPLACE_ELEMENT", "COPY_COLOR_ATTR"

		accessibility_button_support : false, // proper support of <button> as code peg elements (not expecting <input> for now ;-) = "disabled" attribute when needed
		accessibility_accesskey_support : false, // proper support of HTML accesskey attribute on code pegs (works better with some browsers, not at all with others...) = copy of "accesskey" atribute when needed
		reloadWarningTxt : "The current Mastermind game would be lost.", // optionally displayed when reloading page (depends on browser) ; set to empty to leave window.onbeforeunload untouched
	},

	/* Initialize UI */
	init : function(){
		 /* TODO prévoir le cleaning (style et event handling) pour quand on modifie les settings ?... */
		 
		// Wire "color" selection in peg pool
		var poolPegs = $("#peg-pool *[data-peg-color]");
		switch (this.settings.selectionScheme){
		 case "COLOR_FIRST":
		 case "POSITION_FIRST":
		 case "MATRIX" :
			poolPegs.on("click.MastermindBoard.selection", this._colorSelection.clickHandler);
			break;
		 case "DRAG":
		 	poolPegs.attr("draggable", true);
		 	poolPegs.on("dragstart.MastermindBoard.selection", this._colorSelection.dndHandler);		 	
		 	break;
		 default :
			console.error("Unsupported MastermindBoard.settings.selectionScheme : " + this.settings.selectionScheme);
			break;
		}		
		

		// Keep initial state / Optimizations
		this._reset_code = $("#next-guess .code").clone(); // prototype of the "code" ; is supposedly "empty code" (but doesn't have to)
		this._emptyColor = $("#peg-pool *[data-peg-color='']").first().clone();
		this._colors = $("#peg-pool *[data-peg-color][data-peg-color!='']").clone();
		this._elem_btnSubmit = $("#btnSubmit");
		this._elem_decoding_board = $("#decoding-board");

		// prepare game (nothing to clean, so only init here)
		this.reset();

		if (this.settings.reloadWarningTxt) {
			// Curiously, the "proper" way of binding to "onbeforeunload" doesn't behave well : sometimes it brings up a unwarranted confirmation dialog
			// - either with pure JS : window.addEventListener("beforeunload")
			// - or with JQuery : $(window).on("beforeunload")
			// TODO find out WHY.
			window.onbeforeunload = function(e){
				if (MastermindBoard.isGameStage("guessing") || MastermindBoard.isGameStage("feedback")) {
					e.returnValue = MastermindBoard.settings.reloadWarningTxt;
					return MastermindBoard.settings.reloadWarningTxt;
				} else {
					return null;  // expected behaviour = cancel the prompt (but don't rely on it for anything meaningful ;-)
				}
			};
		}

		$(window).on("unload", function(){
			if (MastermindBoard.hooks.onGameStageChange) MastermindBoard.hooks.onGameStageChange("oblivion", MastermindBoard._currentStageName, MastermindBoard._rowIndex);
		});
	},

	/* Reset board before new game */
	reset : function(){
		this._colorSelection.peg = null;
		this._positionSelection.peg = null;

		// for Codemaker
		this._setGameStage("codemaking");
		this._resetCode("hidden");

		// for Codebreaker
		$("#decoding-board > .guess").remove();
		this._rowIndex = 0;
		this._resetCode("guess");
		$("#peg-pool *[data-peg-color]").removeClass("MMSel");
		this._assessSubmittability();

		// optional "draft-zone", for Codebreaker
		this._resetCode("draft");
	},

	/* Ends Codemaker session, starts Codebreaker session */
	startGuessing : function(){
		this._setGameStage("guessing");

		this.randomize();

		// disable all interaction with hidden code
		var hiddenCodePegs = $("#code-shield .code *[data-peg-color]");

		hiddenCodePegs.off("click.MastermindBoard.selection");

		if (this.settings.accessibility_accesskey_support)
			hiddenCodePegs.removeAttr("accesskey");
		if (MastermindBoard.settings.accessibility_button_support)
			hiddenCodePegs.filter("button").prop("disabled", true);

		// init submit button state
		this._assessSubmittability();
	},

	// Generate random code for missings values of hidden code
	randomize : function(){
		var hiddenCodePegs = $("#code-shield .code *[data-peg-color]");
		hiddenCodePegs.each(function(){
			if ($(this).attr("data-peg-color") == "") {
				var rnd = Math.floor(MastermindBoard._colors.length * Math.random());
				var randomPeg = $(MastermindBoard._colors.get(rnd));
				MastermindBoard._positionSelection.peg = $(this);
				MastermindBoard._overwritePositionWith(randomPeg);
			}
		});
		MastermindBoard._positionSelection.peg = null;
		$("#code-shield .code *[data-peg-color]").removeClass("MMSel");
		$("#next-guess .code *[data-peg-color]").removeClass("MMSel");
	},

	submitGuess : function(){
		this._setGameStage("feedback");

		var elem_nextGuess = $("#next-guess .code");
		var elem_hiddenCode = $("#code-shield .code");
		this._rowIndex ++;

		// 1) Extract info from UI and do computations
		var guessCode = this._extractPegColor(elem_nextGuess);
		var hiddenCode = this._extractPegColor(elem_hiddenCode);
		var feedback = this.feedback(hiddenCode, guessCode);

		// 2) Render new row from next guess
		var newGuessRow = $("<div class='guess'></div>");
		newGuessRow.append(elem_nextGuess.clone());
		if (this.settings.selectionScheme == "POSITION_FIRST")
			newGuessRow.find("*[data-peg-color]").removeClass("MMSel");
		if (this.settings.doubleSelectionEffect == "LOCK")
			newGuessRow.find("*[data-peg-color]").removeClass("color-locked");
		if (this.settings.accessibility_accesskey_support)
			newGuessRow.find("*[data-peg-color]").removeAttr("accesskey");
		if (this.settings.accessibility_button_support)
			newGuessRow.find("button[data-peg-color]").prop("disabled", true);
		if (this.hooks.enrichGuessRow)
			this.hooks.enrichGuessRow(newGuessRow, this._rowIndex, feedback);

		if (this.settings.reverseGuessStack){
			this._elem_decoding_board.prepend(newGuessRow);
		} else {
			this._elem_decoding_board.append(newGuessRow);
		}

		// 3) Test victory / loss + display
		if (feedback.correct === hiddenCode.length) {
			this._setGameStage("win");
		} else if (this._rowIndex >= this.settings.maxRowNumber){
			this._setGameStage("loss");
		} else { // -> keep on playing : reset next guess
			this._setGameStage("guessing");
			this._resetCode("guess", true);
		}
		this._assessSubmittability();
	},

	/* Defines the top-most CSS styling with a class "gamestage-*", effectively controlling the static display state.
	Currently the game is expected to progress through : "codemaking", then "guessing" and "feedback" repeatedly, and finally "win" or "loss". */
	_setGameStage : function(stageName){
		var oldStageName = this._currentStageName;
		
		switch(stageName) {
		 case "codemaking":
		 	/* no condition for initial state ! */
		 	break;
		 case "guessing":
		 	if (oldStageName != "codemaking" && oldStageName != "feedback") {
		 		console.error("Unsupported stage transition from \"" + oldStageName + "\" to \"guessing\"");
		 		return;
			}
			break;
		 case "feedback":
		 	if (oldStageName != "guessing") {
		 		console.error("Unsupported stage transition from \"" + oldStageName + "\" to \"feedback\"");
		 		return;
			}
			break;
		 case "win":
		 	if (oldStageName != "feedback") {
		 		console.error("Unsupported stage transition from \"" + oldStageName + "\" to \"won\"");
		 		return;
			}
			break;
		 case "loss":
		 	if (oldStageName != "feedback") {
		 		console.error("Unsupported stage transition from \"" + oldStageName + "\" to \"lost\"");
		 		return;
			}
			break;
		 default:
		 	console.error("Unsupported stage name : " + stageName);
		 	return;
		}
		this._currentStageName = stageName;

		$("#game-board")
		 .removeClass("gamestage-codemaking gamestage-guessing gamestage-feedback gamestage-win gamestage-loss")
		 .addClass("gamestage-" + stageName);
		 
		if (this.hooks.onGameStageChange) this.hooks.onGameStageChange(stageName, oldStageName, this._rowIndex);
	},

	isGameStage : function(stageName){
		switch(stageName) {
		 case "codemaking":
		 case "guessing":
		 case "feedback":
		 case "win":
		 case "loss":
			return this._currentStageName == stageName;
		 default:
		 	console.warn("Unsupported stage name : " + stageName);
		 	return;
		}
	},

	_moveColorToPosition : function(){
		var currentPeg = this._positionSelection.peg;
		var newPeg = this._colorSelection.peg;

		if (!(newPeg && currentPeg)) return;

		/* special action when the same color is re-selected */
		if (newPeg.attr("data-peg-color") === currentPeg.attr("data-peg-color")){
			switch(this.settings.doubleSelectionEffect){
			 case "EMPTY":
			 	newPeg = this._emptyColor;
			 	break; // -> continue selection
			 default:
				console.error("Unsupported MastermindBoard.settings.doubleSelectionEffect : " + MastermindBoard.settings.doubleSelectionEffect);
				// fallthrough
			 case "LOCK":
			 	if (this.isGameStage("guessing")){
			 		currentPeg.toggleClass("color-locked");
			 	} // else ignored (esp. when this.isGameStage("codemaking")...)
			 	// fallthrough
			 case "NONE":
			 	return; // -> abort selection
			}
		}

		this._overwritePositionWith(newPeg);		
		this.hooks.onSelectionDone(currentPeg, newPeg);
		
		if (this._assessSubmittability() && MastermindBoard.settings.autoCommit) {
			this.submitGuess();
		}
	},

	_overwritePositionWith : function(newPegOrig) {
		var currentPeg = this._positionSelection.peg;

		switch(this.settings.selectionEffect){
		 case "REPLACE_ELEMENT":{
			var newPeg = newPegOrig.clone();

			if (currentPeg.hasClass("MMSel")){
				newPeg.addClass("MMSel"); // for scheme "POSITION_FIRST"
			} else {
				newPeg.removeClass("MMSel"); // for scheme "COLOR_FIRST", but harmless for the others
			}

			if (this.settings.accessibility_accesskey_support && currentPeg.attr("accesskey")){
				newPeg.attr("accesskey", currentPeg.attr("accesskey"));
			}
			//TODO : mettre un switch sur les selectionScheme
			newPeg.on("click.MastermindBoard.selection", MastermindBoard._positionSelection.clickHandler);

			newPeg.on("dragover.MastermindBoard.selection", function(e){e.preventDefault();return false;}); //needed for "drop" to work... whatever
			newPeg.on("drop.MastermindBoard.selection", MastermindBoard._positionSelection.dndHandler);
			
			
			newPeg.data("codeType", currentPeg.data("codeType"));

			currentPeg.replaceWith(newPeg);
			this._positionSelection.peg = newPeg;
			break;
		 }
		 case "COPY_COLOR_ATTR":{
		 	var colorValue = newPegOrig.attr("data-peg-color");
		 	currentPeg.attr("data-peg-color", colorValue);

		 	if (this.settings.doubleSelectionEffect == "LOCK"){
		 		currentPeg.removeClass("color-locked");
		 	}
		 	break;
		 }
		 default:
		 	console.error("Unsupported MastermindBoard.settings.selectionEffect : " + this.settings.selectionEffect);
		 	return;
		}	
	},

	_resetCode : function(codeType, keepLocks){
		if (typeof keepLocks == "undefined") keepLocks = false;

		var targetCodeSelector;
		switch (codeType){
			case "hidden" : targetCodeSelector = "#code-shield .code"; break;
			case "guess" :  targetCodeSelector = "#next-guess .code"; break;
			case "draft" :  targetCodeSelector = "#draft-zone .code"; break;
			default: console.error("Unsupported codeType for _resetCode() : " + codeType); return;
		}

		var targetCode = $(targetCodeSelector);
		var targetCodePegs = targetCode.find("*[data-peg-color]");
		var initialCodePegs = this._reset_code.find("*[data-peg-color]");

		if (targetCodePegs.length != initialCodePegs.length) {
			// for initialization of the board : bulk copy
			targetCode.replaceWith(this._reset_code.clone()); // note: it was the initial single line impl. of this function
			//(note : works for initializing multiple "targetCode" too, such as in "draft-zone")
		} else {
			// for all other uses : loop on each peg
			for (var i=0; i<targetCodePegs.length; i++){
				var targetPeg = $(targetCodePegs[i]);
				var initialPeg = $(initialCodePegs[i]);

				if (keepLocks && targetPeg.hasClass("color-locked")) continue;

				switch(this.settings.selectionEffect){
				 case "REPLACE_ELEMENT":{
					targetPeg.replaceWith(initialPeg.clone());
				 }
				 case "COPY_COLOR_ATTR":{
				 	var colorValue = initialPeg.attr("data-peg-color");
				 	targetPeg.attr("data-peg-color", colorValue);

				 	if (this.settings.doubleSelectionEffect == "LOCK"){
				 		targetPeg.removeClass("color-locked");
				 	}
				 	break;
				 }
				 default:
				 	console.error("Unsupported MastermindBoard.settings.selectionEffect : " + this.settings.selectionEffect);
				 	return;
				}
			}
		}

		// Wire position selection
		targetCodePegs = $(targetCodeSelector).find("*[data-peg-color]"); // refresh
		targetCodePegs.off("click.MastermindBoard.selection");
		targetCodePegs.on("click.MastermindBoard.selection", this._positionSelection.clickHandler);
		
		//TODO : mettre un switch sur les selectionScheme
		targetCodePegs.on("dragover.MastermindBoard.selection", function(e){e.preventDefault();return false;}); //needed for "drop" to work... whatever
		targetCodePegs.on("drop.MastermindBoard.selection", this._positionSelection.dndHandler);
		
		targetCodePegs.data("codeType", codeType); //identifies different types of "position pegs"
	},

	/* Enable "submit" button if "next guess" can be submitted.
	Returns true if it does. */
	_assessSubmittability : function(){
		var submittable;

		//submittability based on game stage...
		if (this.isGameStage("guessing")){
			//... and on existence of empty slots
			submittable = ($("#next-guess .code *[data-peg-color='']").length == 0);
		} else {
			submittable = false;
		}

		this._elem_btnSubmit.prop("disabled", !submittable);
		if (submittable) this._elem_btnSubmit.focus();
		return submittable;
	},

	/* Manages "Color" selection */
	_colorSelection : {
		peg : null,
		clickHandler : function(evt){
			MastermindBoard._colorSelection.peg = $(evt.target);

			if (MastermindBoard.hooks.onSelectColor)
				MastermindBoard.hooks.onSelectColor(MastermindBoard._colorSelection.peg);

			switch (MastermindBoard.settings.selectionScheme){
			 case "COLOR_FIRST":
				$("#peg-pool *[data-peg-color]").removeClass("MMSel");
				MastermindBoard._colorSelection.peg.addClass("MMSel");
				break;
			 case "POSITION_FIRST":
				MastermindBoard._moveColorToPosition();
				break;
			 case "DRAG":
			 	/* nothing : ignored */
			 	break;
			 case "MATRIX" :
				alert ("Not supported"); break;
			 default :
				console.error("Unsupported MastermindBoard.settings.selectionScheme : " + MastermindBoard.settings.selectionScheme);
				break;
			}
		},
		dndHandler : function(evt){
			MastermindBoard._colorSelection.peg = $(evt.target);
			evt.originalEvent.dataTransfer.setData("text/plain", "MastermindBoard.colorSelection"); // once again, needed for.. whatever (Firefox mainly)
			
			$("#peg-pool *[data-peg-color]").removeClass("MMSel");
			MastermindBoard._colorSelection.peg.addClass("MMSel");
		}
	},

	/* Manages "Position" selection */
	_positionSelection : {
		peg : null,
		clickHandler : function(evt){
			MastermindBoard._positionSelection.peg = $(evt.target);

			if (MastermindBoard.hooks.onSelectPosition)
				MastermindBoard.hooks.onSelectPosition(MastermindBoard._positionSelection.peg);

			switch (MastermindBoard.settings.selectionScheme){
			 case "COLOR_FIRST":
				MastermindBoard._moveColorToPosition();
				break;
			 case "POSITION_FIRST":
				$("#code-shield .code *[data-peg-color]").removeClass("MMSel");
				$("#next-guess .code *[data-peg-color]").removeClass("MMSel");
				MastermindBoard._positionSelection.peg.addClass("MMSel");
				break;
			 case "DRAG":
			 case "MATRIX" :
			 	/* maybe make this behaviour optional : click position to empty it ? 
			 	TODO how does it work with "LOCK" ?*/
			 	var currentPeg = MastermindBoard._positionSelection.peg;
				MastermindBoard._overwritePositionWith(MastermindBoard._emptyColor);
				MastermindBoard.hooks.onSelectionDone(currentPeg, MastermindBoard._emptyColor);
				break;
			 default :
				console.error("Unsupported MastermindBoard.settings.selectionScheme : " + MastermindBoard.settings.selectionScheme);
				break;
			}
		},
		dndHandler : function(evt){
			if (evt.preventDefault) evt.preventDefault();
			if (evt.stopPropagation) evt.stopPropagation();
			
			MastermindBoard._positionSelection.peg = $(evt.target);
			MastermindBoard._moveColorToPosition();
		}		
	},

	_extractPegColor : function(codeElement){
		return codeElement.children("*[data-peg-color]").map(function(){
			return $(this).attr("data-peg-color");
		}).get();
	},


	/* The bot computes the feedback to one given "guessCode" based on "hiddenCode".

	   The codes are said to be arrays of "digits", in fact those can be any comparable value type (they are typically human-readable strings).

	   params :
		hiddenCode    array of "digits", usually this.hiddenCode
		guessCode     array of "digits", to be compared to hiddencode
	   returns :
	   	an object {correct: integer, misplaced:integer} for "black" and "white" feedback pegs in classical Mastermind
	*/
	/* static */
	feedback: function(hiddenCode, guessCode){
		var _hiddenCode = hiddenCode.slice(); // shallow clone, to be modified on computation

		if (typeof hiddenCode == "string"){ // alternate "clone" for (immutable) string to (mutable) array
			_hiddenCode = new Array();
			for (var i=0; i<hiddenCode.length; i++){
				_hiddenCode.push(hiddenCode[i]);
			}
		}

		var feedbackPegs = new Array(guessCode.length);

		// 1) Tag and remove correct digits ("coloured pegs")...
		for (var i=0; i<guessCode.length; i++){
			if (guessCode[i] === _hiddenCode[i]){
				_hiddenCode[i] = null;
				feedbackPegs[i] = "correct";
			}
		}

		// 2) ...then check misplaced digits ("white pegs") among remaining elements.
		for (var i=0; i<guessCode.length; i++){
			if (feedbackPegs[i] === "correct") continue;
			for (var j=0; j<hiddenCode.length; j++){
				if (guessCode[i] === _hiddenCode[j]){
					_hiddenCode[j] = null;
					feedbackPegs[i] = "misplaced";
					break;
				}
			}
		}

		// 3) Count pegs for consolidated feedback
		var feedback = {correct:0, misplaced:0, missing:0};
		for (var i=0; i<feedbackPegs.length; i++){
			var pegColor = feedbackPegs[i];
			if (typeof pegColor == "undefined") continue;
			//if (!feedback[pegColor]) feedback[pegColor] = 0; -> replaced with initialization (less flexible, more readable)
			feedback[pegColor]++;
		}

		// 4) (Optional) Add the missing count to feedback
		feedback["missing"] = hiddenCode.length - feedback["correct"] - feedback["misplaced"];

		return feedback;
	},

	/* API Hooks, meant to be overridden by implementors */
	hooks: {
		/* Renders additional data on a new guess row (to be overridden) */
		enrichGuessRow : function(newGuessRow, rowIndex, feedback){
			newGuessRow.prepend(
			 `<span> <b>${rowIndex}</b> -
				correct: ${feedback.correct ? feedback.correct : "none"},
			 	misplaced: ${feedback.misplaced ? feedback.misplaced : "none"}
			 </span>`);
		},

		/* Hook for Game stage change (for Winning and Losing, among others) */
		onGameStageChange : function(gameStageTo, gameStageFrom, guessCount) {},

		/* Hook for Color Selection.
		 param "colorElt" is the selected JQuery element ("toggle with empty" nonwithstanding) */
		onSelectColor : function(colorElt){},

		/* Hook for Position Selection.
		 param "positionElt" is the selected JQuery element */
		onSelectPosition : function(positionElt){},
		
		/* Hook for Color selected at one Position. */
		onSelectionDone : function(oldElt, newElt){},

	}
};
