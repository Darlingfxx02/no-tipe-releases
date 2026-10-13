//
//  MediaRemoteAdapter.h
//
//  Copyright © 2024 Ethan Bills. All rights reserved.
//

#ifndef MediaRemoteAdapter_h
#define MediaRemoteAdapter_h

#import <Foundation/Foundation.h>

#ifdef __cplusplus
extern "C" {
#endif

void bootstrap(void);
void loop(void);
void get(void);
void play(void);
void pause_command(void);
void toggle_play_pause(void);
void next_track(void);
void previous_track(void);
void stop_command(void);
void toggle_shuffle(void);
void toggle_repeat(void);
void start_forward_seek(void);
void end_forward_seek(void);
void start_backward_seek(void);
void end_backward_seek(void);
void go_back_fifteen_seconds(void);
void skip_fifteen_seconds(void);
void like_track(void);
void ban_track(void);
void add_to_wish_list(void);
void remove_from_wish_list(void);
void set_time_from_env(void);
void set_shuffle_mode(void);
void set_repeat_mode(void);

#ifdef __cplusplus
}
#endif

#endif /* MediaRemoteAdapter_h */ 