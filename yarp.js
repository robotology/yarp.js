
var _yarp = require('./build/Release/YarpJS'); 

var yarp = new Object();


// make sure to close stuff when Ctrl+C arrives
process.on('SIGINT',function(){
    process.exit();
});




yarp.Bottle = function Bottle() {
    var _bottle = _yarp.Bottle();

    process.on('exit',function () {
        var b = _bottle;
    });

    return _bottle;
}




yarp.Network = function Network() {
    var _net = _yarp.Network();
    
    process.on('exit',function(){
        _net.fini();
    });
    
    return _net;
}




var _unnamed_port_counter = 0;
var _internal_port_manager = [];




yarp.BufferedPort = function BufferedPort(port_type) {


    var port_name = undefined;

    var _port; 

    // create the port
    switch(port_type)
    {
        case 'image':
            _port = new _yarp.BufferedPortImage();
            break;
        case 'bottle':
            _port = new _yarp.BufferedPortBottle();
            break;
        default:
            console.log('Error! "' + port_type + '" is not a valid type!');
    }    

    // this callback is only to stay alive
    function _stayAliveCallback() {
        _port.close();
    }

    // make sure it closes and that it lives up to the end of the loop
    process.on('exit',_stayAliveCallback);

    // remove the _stayAliveCallback so that the port can be collected by garbage collector
    _port.clear = function() {
        _port.close();
        process.removeListener('exit',_stayAliveCallback);
    }


    _port.getName = function () { return port_name;}

    _port._open = _port.open;
    _port.open = function (_port_name) {
        
        var isOpen = false;
        if(_internal_port_manager[_port_name] == undefined && _port._open(_port_name))
        {
            isOpen = true;
            port_name = _port_name;
            _internal_port_manager[port_name] = _port;
        }

        return isOpen;
    }

    _port._close = _port.close;
    _port.close = function () {

        var isClosed = false;

        _port._close();

        if(port_name != undefined)
        {
            _internal_port_manager[port_name]=undefined;
            isClosed = true;
        }
        
        port_name = undefined;

        return isClosed;
    }


    _port._write = _port.write;
    _port.write = function(msg) {
        if(msg != undefined)
        {
            var b = _port.prepare();
            b.fromString(msg);
        }

        _port._write();
    }

    // _port.callback = function (msg) {console.log(port_name + msg)};
    // (default) forward the message
    _port.callback = function (msg) {_port.write(msg.toString())};


    return _port;
}




yarp.portHandler = {

    get:    function get(port_name) {
        var port = undefined;
        if(port_name != undefined && _internal_port_manager[port_name] != undefined)
            port = _internal_port_manager[port_name];

        return port;
    },

    open:   function openBufferedPort(port_name,port_type) {
        
        var port = undefined;

        if(port_name == undefined)
        {
            _unnamed_port_counter++;
            port_name = '/yarpJS/tmp' + _unnamed_port_counter;
        }

        if(port_type == undefined)
            port_type = 'bottle';

        // if the port name is available, use it
        if(_internal_port_manager[port_name] == undefined)
        {
            port = new yarp.BufferedPort(port_type);
            port.open(port_name);
        }
        else
            port = _internal_port_manager[port_name];

        return port;
    },

    close: function close (port_name) {
        if (port_name == undefined || _internal_port_manager[port_name] == undefined)
            return false;

        _internal_port_manager[port_name].clear();

    }

};






yarp.browserCommunicator = function (_io) {

    var io = _io;

    var open = function open(port_name) {
        var port = yarp.portHandler.open(port_name);

        if (port != undefined)
        {
            port.onRead(function (obj) {
                io.emit('yarp ' + port_name + ' message',{obj_type: obj.getObjType(), content: obj.toObject()});
            });

        }

        return port;
    }

    var close = function close(port_name) {
        yarp.portHandler.close(port_name);
        io.emit(port_name + 'disconnected');
    }

    // initialization 
    io.on('connection', function(socket){
        
        console.log('connected');


        // send back the list of ports currently registered to yarp by this server
        socket.on('yarp get active ports',function(){
            io.emit('yarp active ports',Object.keys(_internal_port_manager));
        });


        socket.on('yarp open port',function(port_name){

            port = open(port_name);

            if (port != undefined)
            {
                // if a message is received
                socket.on('yarp ' + port_name + ' message', port.callback ); 

                socket.on('yarp ' + port_name + ' set callback', function(new_callback) {
                    console.log(new_callback);
                    console.log(new_callback.callback);
                    console.log(new_callback.callback.toString());
                    
                    socket.removeListener('yarp ' + port_name + 'message', port.callback);
                    port.callback = new_callback.callback;
                    socket.on('yarp ' + port_name + ' message', port.callback ); 
                })

                io.emit('yarp ' + port_name + ' connection success');
            }
            else
                io.emit('yarp ' + port_name + ' connection error');
        });



        socket.on('yarp close port',function(port_name){
            
            var port = yarp.portHandler.get(port_name)
            
            if (port != undefined)
            {
                socket.removeAllListeners('yarp ' + port_name + ' message');
                yarp.portHandler.close(port_name);
            }    

            io.emit('yarp ' + port_name + 'disconnected');
        });

    });


    return {
        open: open,
        close: close
    }

}





module.exports = yarp;


