// This script cycles through the brightness levels of a Shelly Dimmer2 device using
// a http endpoint at http://<SHELLY_IP>/script/<script_id>/cycleLight

config = {
  url: "http://192.168.178.63/light/0",
  step: 20,
  transition: 1000
}

function cycle(request, response) {
  Shelly.call(
    "HTTP.GET", {
      "url": config.url,
    },
    function(result) {
      let data = JSON.parse(result.body);
      let url = config.url;
      if (data.ison) {
        let new_brightness = data.brightness + config.step;
        if (new_brightness > 100) {
          url += "?turn=off&transition=" + config.transition;
        } else {
          url += "?turn=on&brightness="+ new_brightness + "&transition=" + config.transition;
        }
      } else {
        url += "?turn=on&brightness=20&transition=" + config.transition;
      }
      print("Calling: " + url);
      Shelly.call(
        "HTTP.GET", {"url": url},
        function(result) {
          print(result.body);
        }
      );
      if (response) {
        response.code = 200;
        response.send();
      }
    }
  );
};

//http://<SHELLY_IP>/script/<script_id>/<endpoint_name>
HTTPServer.registerEndpoint("cycleLight", cycle);
