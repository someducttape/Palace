// @flow

var prefs = {general:{},control:{},draw:{type:0,size:2,front:true,color:"rgba(255,0,0,1)",fill:"rgba(255,166,0,0.5)"}},
	propBagList = [];

var db = null;
function initializePropBagDB() {
	var DBOpenRequest = indexedDB.open("propBag",4);

	DBOpenRequest.onerror = function(event) {
		logmsg('Error loading Prop Bag.');
	};

	DBOpenRequest.onsuccess = function(event) {
		// store the result of opening the database in the db variable.
		// This is used a lot below.
		db = DBOpenRequest.result;

		var store = db.transaction("props").objectStore("props");
		var request = store.get('propList');
		request.onsuccess = function() {
			if (request.result) {
				propBagList = request.result.list;
				refreshPropBagView();
			}
		};

		// var getAllKeysRequest = store.getAllKeys(); // purge props that aren't listed ()
		// getAllKeysRequest.onsuccess = function() {
		// 	if (propBagList.length > 0) {
		// 		let keys = getAllKeysRequest.result;
		// 		let notFound = [];
		// 		keys.forEach(function(key) {
		// 			if (propBagList.indexOf(key) === -1 && typeof key === 'number') {
		// 				notFound.push(key);
		// 			}
		// 		});
		// 		if (notFound.length > 0) {
		// 			logmsg('Purging '+notFound.length+' unlisted props.')
		// 			deletePropsFromDB(notFound);
		// 		}
		// 	}
		// }
	};

	DBOpenRequest.onupgradeneeded = function() {
		db = DBOpenRequest.result;
		var store = db.createObjectStore("props", {keyPath: "id"});
		var authorIndex = store.createIndex("name", "name", { unique: false });
		store.put({id: 'propList', list: propBagList});
	};
}
initializePropBagDB();


function deletePropsFromDB(propIds) {
	var tx = db.transaction("props", "readwrite");
	var store = tx.objectStore("props");
	propIds.forEach(function(pid) {
		var index = propBagList.indexOf(pid);
		if (index > -1) {
			propBagList.splice(index,1);
		}
		store.delete(pid);
	});
	store.put({id: 'propList', list: propBagList});
}


function addPropsToDB(props,dontUpdateIds) {
	var tx = db.transaction("props", "readwrite")
	var store = tx.objectStore("props");

	tx.onerror = function() {
		logmsg('Error adding prop to DB: '+tx.error);
	};
	tx.oncomplete = function() {
		if (!dontUpdateIds) refreshPropBagView();
	};

	props.forEach(function(prop) {
		if (propBagList.indexOf(prop.id) < 0 && (prop.img.length > 0 || (prop.img && prop.img.naturalWidth > 0))) { //does prop exist in the bag already?

			store.add({
				id: prop.id,
				name: prop.name,
				prop: {
					x: prop.x,
					y: prop.y,
					w: prop.w,
					h: prop.h,
					head: prop.head,
					ghost: prop.ghost,
					animated: prop.animated,
					bounce: prop.bounce,
					img: getImageData(prop.img)
				}
			});

			if (!dontUpdateIds) propBagList.unshift(prop.id);
		}
	});

	if (!dontUpdateIds) store.put({id: 'propList', list: propBagList});
	return store;
}




function saveProp(id,flush) {
	var prop = allProps[id];
	if (prop) addPropsToDB([prop]);
}

let getTransactions = {};
function getBagProp(id,img) {
	var transaction = db.transaction("props","readonly");
	getTransactions[id] = transaction;
	var store = transaction.objectStore("props");
	var result = store.get(id);
	result.onsuccess = function(event) {
		delete getTransactions[id];
		if (result.result.prop.ghost) img.className = 'bagprop ghost';
		img.src = result.result.prop.img;

	};
	transaction.onabort = function(event) {

		delete getTransactions[id];
	};
}

function cacheBagProp(id,toUpload,callback) {
	var store = db.transaction("props","readonly").objectStore("props");
	var result = store.get(id);
	result.onsuccess = function(event) {
		var aProp = new PalaceProp(id,result.result);
		allProps[id] = aProp;
		if (callback) callback();
		if (toUpload) {
			var p = {props:[
					{format:'png',name:aProp.name,size:{w:aProp.w,h:aProp.h},
					offsets:{x:aProp.x,y:aProp.y},flags:aProp.encodePropFlags,
					id:aProp.id,crc:0}
				]};
			httpPostAsync(
				palace.mediaUrl + 'webservice/props/new/',
				propUploadCallBack,
				function(status,response) {
					logmsg('Prop upload request failed (HTTP ERROR): '+status+'\n\n'+response);
				},
				JSON.stringify(p)
			);
		}
	};
}


function extractGifFrames(file,callback) {

	let gifCanvas = document.createElement('canvas');
	let gifctx = gifCanvas.getContext("2d");
	let tempcanvas = document.createElement('canvas');
	let tempctx = tempcanvas.getContext("2d");

	let dispose = 0,imgData,propIds = [],store;

	let gifWorker = new Worker('js/workers/gifextract.js');

	gifWorker.addEventListener('message', function(e) {

		if (e.data.frame) {
			let frame = e.data.frame;
			let dims = frame.dims;

			if(!imgData || dims.width != imgData.width || dims.height != imgData.height){
				tempcanvas.width = dims.width;
				tempcanvas.height = dims.height;
				imgData = tempctx.createImageData(dims.width, dims.height);
			}

			if (dispose >= 2) {
				gifctx.clearRect(0, 0, gifCanvas.width, gifCanvas.height);
			}
			dispose = frame.disposalType;

			imgData.data.set(frame.patch);

			tempctx.putImageData(imgData,0,0);
			gifctx.drawImage(tempcanvas, dims.left, dims.top);

			let prop = createNewProp(gifCanvas,true);
			store = addPropsToDB([prop],true);
			propIds.unshift(prop.id);

			if (e.data.finished) {
				if (store) {
					propIds.forEach(function(pid) {
						propBagList.unshift(pid);
					});
					let request = store.put({id: 'propList', list: propBagList});
					request.onsuccess = function() {
						refreshPropBagView();
					};
				}
				this.terminate();
				callback();
			}
		}
		if (e.data.width) {
			gifCanvas.width = e.data.width;
			gifCanvas.height = e.data.height;
		}

	});

	gifWorker.addEventListener('error', function(e) {
		this.terminate();
		callback();
	});

	gifWorker.postMessage(file);
}

function createNewProps(list) {
	for (var i = 0, files = new Array(list.length); i < list.length; i++) {
		files[i] = list[i]; // moving the list to an actual array so pop works , lol
	}
	var button = document.getElementById('newprops');
	button.className += ' loadingbutton';

	let importFile = function() {
		if (files.length > 0) {
			let file = files.pop();

			if (file.type == 'image/gif') {
				extractGifFrames(file,importFile);
			} else {

				let img = document.createElement('img');
				img.onerror = function() {
					importFile();
				};
				img.onload = function() {
					addPropsToDB([createNewProp(this)]);
					importFile();
				};
				img.src = file.path;
			}
		} else {
			button.className = 'tbcontrol tbbutton';
		}
	};
	importFile();
}

function calculateAspectRatio(w,h,newSize) {
	if (w > newSize) {
		h=h*(newSize/w);
		w=newSize;
	}
	if (h > newSize) {
		w=w*(newSize/h);
		h=newSize;
	}
	return {w:w,h:h};
}
function createNewProp(img,animated) {
	let id = 0;

	do {
		id = Math.round(Math.random()*2147483647);
		if (id % 2) id = -id;
	} while (propBagList.indexOf(id) > -1);

	let d = calculateAspectRatio(img.width,img.height,220);
	let c = document.createElement('canvas');

	c.width = d.w.fastRound();
	c.height = d.h.fastRound();
	c = c.getContext('2d');
	c.imageSmoothingEnabled = true;
	c.imageSmoothingQuality = 'high';
	c.drawImage(img,0,0,img.width,img.height,0,0,c.canvas.width,c.canvas.height);

	let prop = {
		id:id,
		name:'Palace Prop',
		w:c.canvas.width,
		h:c.canvas.height,
		x:(-Math.trunc(c.canvas.width/2))+22,
		y:(-Math.trunc(c.canvas.height/2))+22,
		head:true,
		ghost:false,
		animated:Boolean(animated),
		bounce:false,
		img:c.canvas.toDataURL("image/png")
	};

	return prop;
}


document.onpaste = function(e){
	var loadImage = function (file) {
		var reader = new FileReader();
		reader.onload = function(e){
			createNewProps([{path:e.target.result}]);
		};
		reader.readAsDataURL(file);
	};
    var items = e.clipboardData.items;
    for (var i = 0; i < items.length; i++) {
        if (/^image\/(p?jpeg|gif|png)$/i.test(items[i].type)) {
            loadImage(items[i].getAsFile());
            return;
        }
    }
}


function setControlPrefs(id,obj) {
	prefs.control[id] = obj;
}

function getControlPrefs(id) {
	return prefs.control[id];
}

function setGeneralPref(id,value) {
	prefs.general[id] = value;
}

function getGeneralPref(id) {
	return prefs.general[id];
}

window.onunload = function(e) {
	localStorage.preferences = JSON.stringify(prefs);
};

(function () { // LOAD PREFERENCES
	var a;
	if (localStorage.preferences) { // redo preferences!
		prefs = JSON.parse(localStorage.preferences);
		document.getElementById('drawcolor').style.backgroundColor = prefs.draw.color;
		document.getElementById('drawfill').style.backgroundColor = prefs.draw.fill;
		document.getElementById('drawsize').value = prefs.draw.size;
		a = getGeneralPref('propBagWidth');
		if (a) propBag.style.width = a+'px';
		a = getGeneralPref('chatLogWidth');
		if (a) logField.style.width = a+'px';
		a = getGeneralPref('propBagTileSize');
		if (a) document.getElementById('prefpropbagsize').value = a;
		a = getGeneralPref('viewScales');
		if (a) document.getElementById('prefviewfitscale').checked = a;
		a = getGeneralPref('viewScaleAll');
		if (a) document.getElementById('prefviewscaleall').checked = a;
		a = getGeneralPref('disableSounds');
		if (a) document.getElementById('prefdisablesounds').checked = a;
		a = getGeneralPref('autoplayvideos');
		if (a) document.getElementById('prefautoplayvideos').checked = a;
        a = getGeneralPref('senddebug');
        if (a) document.getElementById('senddebug').checked = a;
		setDrawType();
	} else { //default
		prefs.registration = {regi:getRandomInt(100,2147483647),puid:getRandomInt(1,2147483647)};
		setGeneralPref('home','ee.fastpalaces.com:9991'); //avatarpalace.net:9998
		setGeneralPref('userName','Palace User');
		setGeneralPref('propBagTileSize',91);
		setGeneralPref('viewScaleAll',true);
        setGeneralPref('senddebug',true);
		//setGeneralPref('propBagWidth',200);
	}
	document.getElementById('prefusername').value = getGeneralPref('userName');
	document.getElementById('prefhomepalace').value = getGeneralPref('home');
})();
