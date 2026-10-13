#!/usr/bin/perl

# Copyright (c) 2025 Jonas van den Berg
# This file is licensed under the BSD 3-Clause License.

use strict;
use warnings;
use DynaLoader;

# --- Autoflush STDOUT ---
# This is critical. It prevents Perl from buffering output and ensures
# that data is sent to the parent Swift process immediately.
$| = 1;

# --- Script Setup ---
# This script dynamically loads the MediaRemoteAdapter dylib and executes
# a command. It's designed to be called by a parent process that provides
# the full path to the dylib.

my $usage = "Usage: $0 <path_to_dylib> <loop|play|pause|...>";
die $usage unless @ARGV >= 2;

my $dylib_path = shift @ARGV;
my $command = shift @ARGV;

unless (-e $dylib_path) {
    die "Dynamic library not found at $dylib_path\n";
}

# --- Manual DynaLoader Invocation ---

# 1. Load the library file directly.
my $libref = DynaLoader::dl_load_file($dylib_path)
    or die "Can't load '$dylib_path': " . DynaLoader::dl_error();

# 2. Find and install each C function as a Perl subroutine.
# This avoids any high-level magic and gives us direct control.
sub install_xsub {
    my ($perl_name, $lib) = @_;
    # C functions are usually prefixed with an underscore by the compiler.
    my $c_name = "_" . $perl_name;

    my $symref = DynaLoader::dl_find_symbol($lib, $c_name);
    
    # If the mangled name isn't found, try the plain name as a fallback.
    unless ($symref) {
        $symref = DynaLoader::dl_find_symbol($lib, $perl_name);
    }

    die "Can't find symbol '$perl_name' or '$c_name' in '$dylib_path'" unless $symref;
    
    # Install the C function into the main:: namespace so we can call it.
    DynaLoader::dl_install_xsub("main::" . $perl_name, $symref);
}

# 3. Install all the functions we need from the library.
install_xsub("bootstrap", $libref);
install_xsub("loop", $libref);
install_xsub("play", $libref);
install_xsub("pause_command", $libref);
install_xsub("toggle_play_pause", $libref);
install_xsub("next_track", $libref);
install_xsub("previous_track", $libref);
install_xsub("stop_command", $libref);
install_xsub("toggle_shuffle", $libref);
install_xsub("toggle_repeat", $libref);
install_xsub("start_forward_seek", $libref);
install_xsub("end_forward_seek", $libref);
install_xsub("start_backward_seek", $libref);
install_xsub("end_backward_seek", $libref);
install_xsub("go_back_fifteen_seconds", $libref);
install_xsub("skip_fifteen_seconds", $libref);
install_xsub("like_track", $libref);
install_xsub("ban_track", $libref);
install_xsub("add_to_wish_list", $libref);
install_xsub("remove_from_wish_list", $libref);
install_xsub("set_time_from_env", $libref);
install_xsub("set_shuffle_mode", $libref);
install_xsub("set_repeat_mode", $libref);
install_xsub("get", $libref);

# 4. Call the bootstrap function to initialize the C code.
bootstrap();

# 5. Execute the requested command by calling the newly installed subroutine.
if ($command eq 'loop') {
    loop();
} elsif ($command eq 'play') {
    play();
} elsif ($command eq 'pause') {
    pause_command();
} elsif ($command eq 'toggle_play_pause') {
    toggle_play_pause();
} elsif ($command eq 'next_track') {
    next_track();
} elsif ($command eq 'previous_track') {
    previous_track();
} elsif ($command eq 'stop') {
    stop_command();
} elsif ($command eq 'toggle_shuffle') {
    toggle_shuffle();
} elsif ($command eq 'toggle_repeat') {
    toggle_repeat();
} elsif ($command eq 'start_forward_seek') {
    start_forward_seek();
} elsif ($command eq 'end_forward_seek') {
    end_forward_seek();
} elsif ($command eq 'start_backward_seek') {
    start_backward_seek();
} elsif ($command eq 'end_backward_seek') {
    end_backward_seek();
} elsif ($command eq 'go_back_fifteen_seconds') {
    go_back_fifteen_seconds();
} elsif ($command eq 'skip_fifteen_seconds') {
    skip_fifteen_seconds();
} elsif ($command eq 'like_track') {
    like_track();
} elsif ($command eq 'ban_track') {
    ban_track();
} elsif ($command eq 'add_to_wish_list') {
    add_to_wish_list();
} elsif ($command eq 'remove_from_wish_list') {
    remove_from_wish_list();
} elsif ($command eq 'set_time') {
    my $time = $ARGV[0];
    die "Missing time argument for set_time\n" unless defined $time;
    $ENV{'MEDIAREMOTE_SET_TIME'} = $time;
    set_time_from_env();
} elsif ($command eq 'set_shuffle_mode') {
    my $mode = $ARGV[0];
    die "Missing mode argument for set_shuffle_mode\n" unless defined $mode;
    $ENV{'MEDIAREMOTE_SET_SHUFFLE_MODE'} = $mode;
    set_shuffle_mode();
} elsif ($command eq 'set_repeat_mode') {
    my $mode = $ARGV[0];
    die "Missing mode argument for set_repeat_mode\n" unless defined $mode;
    $ENV{'MEDIAREMOTE_SET_REPEAT_MODE'} = $mode;
    set_repeat_mode();
} elsif ($command eq 'get') {
    get();
} else {
    die "Unknown command: $command\n";
}

# For single commands, add a tiny sleep. This gives the command time to be processed
# by the system before this script exits and the pipe closes.
if ($command ne 'loop') {
    select(undef, undef, undef, 0.01); # Sleep for 100ms
} 