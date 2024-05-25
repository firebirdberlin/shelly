// Dynamic sun protection
//
// This script closes the covers according to the current weather conditions which
// are retrieved from the wttr.in weather api for the current location. It uses four schedules:
//
// 1. Sunrise: Activates the periodic task
// 2. Periodc task which checks weather condition
// 3. Finalization task which deatvates the weather check
// 4. Sunset: deactivate schedules (may happen before step 3)
//
// Docs:
// timespec: https://github.com/mongoose-os-libs/cron
// shelly gen 2 devices: https://shelly-api-docs.shelly.cloud/gen2/
//
// Tested on Shelly Plus 2PM with firmware 1.0
//
//////////////////////////////////// configuration ////////////////////////////////////////////////
// periodic task
// timespec: seconds, minutes, hours, day_in_month, month, day_of_week
let JOB_CONFIG = {
    key: "Script-Schedule-" + JSON.stringify(Shelly.getCurrentScriptId()),
    timespec: "0 45/15 7-14 * * *",  // repeat every 15 minutes between 8 and 14 o'clock
    func: "run()",                  // entry point for this schedule
    url: "http://wttr.in/%lat%,%lon%?format=j2",  // weather service url
    url2: "https://api.open-meteo.com/v1/forecast?latitude=%lat%&longitude=%lon%&hourly=temperature_2m,cloudcover,cloudcover_low,cloudcover_mid,cloudcover_high&daily=sunrise,sunset&current_weather=true&timeformat=unixtime&timezone=%timezone%&forecast_days=1",
    min_temperature: 8,            // activate sun-protection, only if temprature is greater than
    max_cloudcover: 20,              // cloud coverage which shall activate protection,
    cover_pos_normal: 100,          // cover position for cloudy days (100: fully open, 0: fully closed)
    cover_pos_sun_protection: 60,   // cover position for sun protection
};

// final task which deactivates the periodic task
// timespec
let JOB_CONFIG_FINALIZE = {
    key: "Script-Schedule-Finalize-" + JSON.stringify(Shelly.getCurrentScriptId()),
    //timespec: "@sunset-1h",       // 1h before sunset every day
    timespec: "30 35 13 * * *",     // Runs at 13:35:30 every day
    func: "runAtEnd()",             // entry point for this schedule
    cover_pos: 100,                 // cover position (100: fully open)
};

//////////////////////////////////////// functions ////////////////////////////////////////////////

let cover = {
    state: null,
    last_direction: null,
    current_pos: null,
};

let weather = {
    temp: null,
    cloudcover: null,
    is_day: null,
    localObsDateTime: null,
    requestTime: null,
};

function getCoverStatus() {
    Shelly.call("Cover.GetStatus", {id:0}, function(result) {
        //print("status ", result);
        cover.state = result.state;
        cover.last_direction = result.last_direction;
        cover.current_pos = result.current_pos;
        print("cover", cover);
    }
    );
}


function log(message) {
    let date = Date();
    console.log(date.getHours() + ":" + date.getMinutes(), message);
}


function registerIfNotRegistered(config, enable) {
    print("Trying to register ", config.key);
    Shelly.call(
        "KVS.Get", {key: config.key},
        function (result, error_code, error_message) {
            print("Read from KVS", JSON.stringify(error_code));
            //we are not registered yet
            if (error_code !== 0) {
                installSchedule(config, enable);
                return;
            }
            let schedule_id = result.value;
            //check if the schedule was deleted and reinstall
            Shelly.call("Schedule.List", {}, function (result) {
                let i = 0;
                for (i = 0; i < result.jobs.length; i++) {
                    if (result.jobs[i].id === schedule_id) return;
                }
                installSchedule(config, enable);
            });
        }
    );
}


function installSchedule(config, enable) {
    Shelly.call(
        "Schedule.Create",
        {
            enable: enable,
            timespec: config.timespec,
            calls: [
                {
                    method: "script.eval",
                    params: {
                        id: Shelly.getCurrentScriptId(),
                        code: config.func,
                    },
                },
            ],
        },
        function (result) {
            //save a record that we are registered
            saveScheduleIDInKVS(config.key, result.id);
            print("Registered schedule", config.key, result, config.timespec);
        }
    );
}


function saveScheduleIDInKVS(key, scheduleId) {
    Shelly.call("KVS.Set", {
        key: key,
        value: scheduleId,
    });
}


function deleteScheduleById(id) {
    Shelly.call(
        "Schedule.Delete",
        {id: id},
        function (result) {
            print("Deleted: ", result);
        }
    );
}


function updateScheduleById(id, enable, config) {
    Shelly.call(
        "Schedule.Update",
        {id: id, enable: enable, timespec: config.timespec},
        function (result) {
            print("Updated:", config.key, enable, result);
        }
    );
}


function updateSchedule(config, enable) {
    print("Updating ", config.key);
    Shelly.call(
        "KVS.Get", {key: config.key},
        function (result, error_code, error_message) {
            print("Read from KVS", JSON.stringify(error_code));
            if (error_code === 0) {
                updateScheduleById(result.value, enable, config)
            }
        }
    );
}


function deleteSchedule(config) {
    print("Deleting ", config);
    Shelly.call(
        "KVS.Get", {key: config.key},
        function (result, error_code, error_message) {
            print("Read from KVS", JSON.stringify(error_code));
            if (error_code === 0) {
                deleteScheduleById(result.value)
            }
        }
    );
}


function contains(string, substring) {
    return (string.indexOf(substring) !== -1);
}


function goToPosition(pos) {
    if (cover.current_pos == pos) {
         log("No position change needed");
        return;
    }
    Shelly.call("Cover.GoToPosition", {id: 0, pos: pos});
}


function moveCoverOnResult(weather) {
    print("result: ", weather);
    Shelly.call("KVS.Set", {key: "wttr", value: JSON.stringify(weather)});

    // check button up state; if button is up, don't move at all
    let state = Shelly.getComponentStatus('input', 0);
    if (state['state'] == true) {
        print("button up is true; skipping");
        return;
    }

    if (weather.temp > JOB_CONFIG.min_temperature && weather.cloudcover < JOB_CONFIG.max_cloudcover) {
        goToPosition(JOB_CONFIG.cover_pos_sun_protection);
    } else if (weather.is_day == null || weather.is_day == 1) {
        goToPosition(JOB_CONFIG.cover_pos_normal);
    }
};


function parsewttr(result) {
    //print(result)
    if (result == null || result.code != 200) {
        log(result);
        return;
    }
    log("wttr response received: " + result.code);
    var data = JSON.parse(result.body);
    weather.cloudcover = data.current_condition[0].cloudcover;
    weather.temp = data.current_condition[0].temp_C;
    weather.localObsDateTime = data.current_condition[0].localObsDateTime;
    weather.requestTime = Date();
    print("weather: ", weather);

    moveCoverOnResult(weather);
};


function parseOpenMeteo(result) {
    if (result == null || result.code != 200) {
        log(result);
        return;
    }
    log("OpenMeteo response received: " + result.code);
    let data = JSON.parse(result.body);
    //print(data);
    let now = Date();
    let hour = now.getHours();

    weather.temp = data.current_weather.temperature;
    weather.cloudcover = data.hourly.cloudcover_high[hour];
    weather.is_day = data.current_weather.is_day;
    weather.localObsDateTime = data.current_weather.time;
    weather.requestTime = now;

    moveCoverOnResult(weather);

};


/////////////////////////////////////// entry points //////////////////////////////////////////////


function runAtSunrise() {
    // enable the periodic job
    updateSchedule(JOB_CONFIG, true);
    updateSchedule(JOB_CONFIG_FINALIZE, true);
}


function runAtSunset() {
    // disbale the periodic job
    updateSchedule(JOB_CONFIG, false);
    updateSchedule(JOB_CONFIG_FINALIZE, false);
}


//Actual task that is to be run periodically
function run() {
    getCoverStatus();

    log("running weather check.");

    let config = Shelly.getComponentConfig("sys");

    let url = JOB_CONFIG.url2.replace("%lat%", config.location.lat);
    url = url.replace("%lon%", config.location.lon);
    url = url.replace("%timezone%", config.location.tz);

    let func = parseOpenMeteo;
    if (contains(url, "wttr.in")) {
        func = parsewttr;
    }
    Shelly.call("HTTP.GET", {"url": url}, func);
};


// Task at the end of the process
function runAtEnd() {
    // disable the periodic job
    updateSchedule(JOB_CONFIG, false);

    // go to the final normal cover position
    goToPosition(JOB_CONFIG_FINALIZE.cover_pos);
}


///////////////////////////////// main initialization /////////////////////////////////////////////
let JOB_CONFIG_SUNRISE = {
    key: "Script-Schedule-Sunrise-" + JSON.stringify(Shelly.getCurrentScriptId()),
    timespec: "@sunrise",
    func: "runAtSunrise()",
};

let JOB_CONFIG_SUNSET = {
    key: "Script-Schedule-Sunset-" + JSON.stringify(Shelly.getCurrentScriptId()),
    timespec: "@sunset",
    func: "runAtSunset()",
};

//// uncomment if you want to delete the schedules entirely
//deleteSchedule(JOB_CONFIG_SUNRISE);
//deleteSchedule(JOB_CONFIG_SUNSET);
//deleteSchedule(JOB_CONFIG);
//deleteSchedule(JOB_CONFIG_FINALIZE);

// register all schedules
function register() {
    registerIfNotRegistered(JOB_CONFIG_SUNRISE, /*enable=*/true);
    registerIfNotRegistered(JOB_CONFIG_SUNSET, /*enable=*/true);
    registerIfNotRegistered(JOB_CONFIG, /*enable=*/true);
    registerIfNotRegistered(JOB_CONFIG_FINALIZE, /*enable=*/true);
}

register();
// run();
