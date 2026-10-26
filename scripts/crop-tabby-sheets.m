#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ImageIO/ImageIO.h>

static void cropSheet(NSString *source, NSArray<NSString *> *names, NSString *destination) {
  CGImageSourceRef imageSource = CGImageSourceCreateWithURL((__bridge CFURLRef)[NSURL fileURLWithPath:source], NULL);
  CGImageRef image = CGImageSourceCreateImageAtIndex(imageSource, 0, NULL);
  size_t cellWidth = CGImageGetWidth(image) / 3;
  size_t cellHeight = CGImageGetHeight(image) / 2;
  for (NSUInteger index = 0; index < names.count; index++) {
    size_t column = index % 3;
    size_t row = index / 3;
    CGRect rect = CGRectMake(column * cellWidth, row * cellHeight, cellWidth, cellHeight);
    CGImageRef tile = CGImageCreateWithImageInRect(image, rect);
    NSString *path = [destination stringByAppendingPathComponent:[names[index] stringByAppendingString:@".png"]];
    CGImageDestinationRef writer = CGImageDestinationCreateWithURL(
      (__bridge CFURLRef)[NSURL fileURLWithPath:path], CFSTR("public.png"), 1, NULL
    );
    CGImageDestinationAddImage(writer, tile, NULL);
    CGImageDestinationFinalize(writer);
    CFRelease(writer);
    CGImageRelease(tile);
  }
  CGImageRelease(image);
  CFRelease(imageSource);
}

int main(void) {
  @autoreleasepool {
    NSString *root = [[[NSFileManager defaultManager] currentDirectoryPath]
      stringByAppendingPathComponent:@"frontend/public/cat-v2"];
    NSString *masters = [root stringByAppendingPathComponent:@"masters"];
    NSString *solo = [root stringByAppendingPathComponent:@"solo"];
    NSString *duo = [root stringByAppendingPathComponent:@"duo"];
    cropSheet([masters stringByAppendingPathComponent:@"solo-01.png"], @[@"hi", @"cool", @"hmm", @"over-budget", @"payday", @"need-money"], solo);
    cropSheet([masters stringByAppendingPathComponent:@"solo-02.png"], @[@"out-of-cash", @"bill-shock", @"love", @"salute", @"working", @"done"], solo);
    cropSheet([masters stringByAppendingPathComponent:@"solo-03.png"], @[@"oops", @"remember", @"autopilot", @"morning", @"celebrate", @"thinking"], solo);
    cropSheet([masters stringByAppendingPathComponent:@"duo-01.png"], @[@"settle-up", @"confirmed", @"send-payment", @"payment-received", @"split-bill", @"equal-share"], duo);
    cropSheet([masters stringByAppendingPathComponent:@"duo-02.png"], @[@"reminder", @"pending", @"thanks", @"save-together", @"goal-reached", @"debt-cleared"], duo);
  }
  return 0;
}
