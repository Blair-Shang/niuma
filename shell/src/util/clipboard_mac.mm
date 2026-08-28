#include "util/win_clipboard.h"

#import <AppKit/AppKit.h>

namespace niuma {

bool ReadClipboardText(std::string& text, std::string& error) {
  text.clear();
  error.clear();
  @autoreleasepool {
    NSPasteboard* pasteboard = [NSPasteboard generalPasteboard];
    NSString* value = [pasteboard stringForType:NSPasteboardTypeString];
    if (value == nil) {
      error = "clipboard has no text";
      return false;
    }
    const char* utf8 = [value UTF8String];
    text = utf8 ? utf8 : "";
    return true;
  }
}

bool WriteClipboardText(const std::string& text, std::string& error) {
  error.clear();
  @autoreleasepool {
    NSString* owned = [[NSString alloc] initWithBytes:text.data()
                                               length:text.size()
                                             encoding:NSUTF8StringEncoding];
    NSString* value = owned != nil ? owned : @"";
    NSPasteboard* pasteboard = [NSPasteboard generalPasteboard];
    [pasteboard clearContents];
    const BOOL ok = [pasteboard setString:value forType:NSPasteboardTypeString];
    [owned release];
    if (!ok) {
      error = "NSPasteboard setString failed";
      return false;
    }
    return true;
  }
}

}  // namespace niuma
