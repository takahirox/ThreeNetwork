( function () {

	var KEY_SPEED = 0.015;
	var KEY_ANIMATION_DURATION = 80;

	var MOUSE_SPEED_X = 0.5;
	var MOUSE_SPEED_Y = 0.3;

	THREE.FPControls = function ( object, domElement ) {

		this.object = object;

		this.width = domElement.width;
		this.height = domElement.height;

		this.phi = 0;
		this.theta = 0;

		this.targetAngle = null;
		this.angleAnimation = null;

		this.position = new THREE.Vector3().copy( object.position );
		this.orientation = new THREE.Quaternion();

		this.rotateStart = new THREE.Vector2();
		this.rotateEnd = new THREE.Vector2();
		this.rotateDelta = new THREE.Vector2();
		this.isDragging = false;

		this.orientationOut_ = new Float32Array( 4 );

		domElement.addEventListener( 'wheel', this.onMouseWheel.bind( this ) );
		domElement.addEventListener( 'mousemove', this.onMouseMove.bind( this ) );
		domElement.addEventListener( 'mousedown', this.onMouseDown.bind( this ) );
		domElement.addEventListener( 'mouseup', this.onMouseUp.bind( this ) );

	};

	Object.assign( THREE.FPControls.prototype, {

		onMouseWheel: function ( e ) {

			e.preventDefault();
			e.stopPropagation();

			this.position.x += Math.sin( this.theta ) * KEY_SPEED * e.deltaY;
			this.position.y += Math.sin( -this.phi ) * KEY_SPEED * e.deltaY;
			this.position.z += Math.cos( this.theta ) * KEY_SPEED * e.deltaY;

		},

		onMouseUp: function ( e ) {

			this.isDragging = false;

		},

		onMouseDown: function ( e ) {

			this.rotateStart.set( e.clientX, e.clientY );
			this.isDragging = true;

		},

		onMouseMove: function ( e ) {

			if ( ! this.isDragging && ! this.isPointerLocked() ) return;

			if ( this.isPointerLocked() ) {

				var movementX = e.movementX || e.mozMovementX || 0;
				var movementY = e.movementY || e.mozMovementY || 0;
				this.rotateEnd.set( this.rotateStart.x - movementX, this.rotateStart.y - movementY );

			} else {

				this.rotateEnd.set( e.clientX, e.clientY );

			}

			this.rotateDelta.subVectors( this.rotateEnd, this.rotateStart );
			this.rotateStart.copy( this.rotateEnd );

			this.phi -= 2 * Math.PI * this.rotateDelta.y / this.height * MOUSE_SPEED_Y;
			this.theta -= 2 * Math.PI * this.rotateDelta.x / this.width * MOUSE_SPEED_X;

			this.phi = this.clamp( this.phi, -Math.PI / 2, Math.PI / 2 );

		},

		animateTheta: function ( targetAngle ) {

			this.animateKeyTransitions( 'theta', targetAngle );

		},

		animatePhi: function ( targetAngle ) {

			targetAngle = this.clamp( targetAngle, -Math.PI / 2, Math.PI / 2 );
			this.animateKeyTransitions( 'phi', targetAngle );

		},

		animateKeyTransitions: function ( angleName, targetAngle ) {

			if ( this.angleAnimation ) cancelAnimationFrame( this.angleAnimation );

			var startAngle = this[ angleName ];

			var startTime = new Date();

			this.angleAnimation = requestAnimationFrame( function animate() {

				var elapsed = new Date() - startTime;

				if ( elapsed >= KEY_ANIMATION_DURATION ) {

					this[ angleName ] = targetAngle;
					cancelAnimationFrame( this.angleAnimation );

					return;

				}

				this.angleAnimation = requestAnimationFrame( animate.bind( this ) )

				var percent = elapsed / KEY_ANIMATION_DURATION;
				this[ angleName ] = startAngle + ( targetAngle - startAngle ) * percent;

			}.bind( this ) );

		},

		isPointerLocked: function () {

			var el = document.pointerLockElement || document.mozPointerLockElement ||
				document.webkitPointerLockElement;

			return el !== undefined;

		},

		clamp: function ( value, min, max ) {

			return Math.min( Math.max( min, value ), max );

		},

		setFromEulerYXZ: function( quaternion, x, y, z ) {

			var c1 = Math.cos( x / 2 );
			var c2 = Math.cos( y / 2 );
			var c3 = Math.cos( z / 2 );
			var s1 = Math.sin( x / 2 );
			var s2 = Math.sin( y / 2 );
			var s3 = Math.sin( z / 2 );

			quaternion.x = s1 * c2 * c3 + c1 * s2 * s3;
			quaternion.y = c1 * s2 * c3 - s1 * c2 * s3;
			quaternion.z = c1 * c2 * s3 - s1 * s2 * c3;
			quaternion.w = c1 * c2 * c3 + s1 * s2 * s3;

		},

		update: function () {

			this.object.position.copy( this.position );

			this.setFromEulerYXZ( this.orientation, this.phi, this.theta, 0 );
			this.object.quaternion.copy( this.orientation );

		}

	} );

} )();
