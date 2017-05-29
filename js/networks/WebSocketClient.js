( function () {

	THREE.WebSocketClient = function ( params ) {

		THREE.NetworkClient.call( this, params );

	};

	THREE.WebSocketClient.prototype = Object.create( THREE.NetworkClient.prototype );
	THREE.WebSocketClient.prototype.constructor = THREE.WebSocketClient;

	Object.assign( THREE.WebSocketClient.prototype, {

	} );

} )();
