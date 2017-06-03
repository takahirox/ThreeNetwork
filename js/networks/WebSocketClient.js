/**
 * @author Takahiro https://github.com/takahirox
 *
 * TODO
 *   implement
 */

( function () {

	/**
	 * WebSocketClient constructor.
	 * General WebSocket based NetworkClient.
	 * @param params - parameters for instantiate.
	 */
	THREE.WebSocketClient = function ( params ) {

		THREE.NetworkClient.call( this, params );

	};

	THREE.WebSocketClient.prototype = Object.create( THREE.NetworkClient.prototype );
	THREE.WebSocketClient.prototype.constructor = THREE.WebSocketClient;

	Object.assign( THREE.WebSocketClient.prototype, {

	} );

} )();
